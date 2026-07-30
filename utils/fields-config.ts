// Dynamic field discovery for any Twenty CRM instance.
// Auto-discovers Person fields, types, and enum values via GraphQL.

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: 'SELECT' | 'TEXT' | 'BOOLEAN' | 'RELATION';
  options?: FieldOption[];
}

const DEFAULT_FIELDS: FieldDefinition[] = [
  { name: 'jobTitle', label: 'Job Title', type: 'TEXT' },
  { name: 'city', label: 'City', type: 'TEXT' },
];

async function gqlReq(url: string, token: string, query: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers['Authorization'] = 'Bearer *** + token;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  }).then(r => r.json());
}

export async function discoverFields(
  graphqlUrl: string,
  token: string
): Promise<FieldDefinition[]> {
  try {
    const data = await gqlReq(graphqlUrl, token,
      'query { __type(name: "Person") { fields { name type { name kind enumValues { name } } } } }'
    );

    if (data.errors) {
      console.log('[FieldsConfig] Introspection disabled, using defaults');
      return DEFAULT_FIELDS;
    }

    const personFields = data.data?.__type?.fields;
    if (!personFields) return DEFAULT_FIELDS;

    const fields: FieldDefinition[] = [];
    const skip = new Set([
      'id', 'createdAt', 'updatedAt', 'deletedAt', 'searchVector', 'position',
      'name', 'emails', 'phones', 'linkedinLink', 'xLink', 'avatarUrl',
      'avatarFile', 'company', 'companyId',
    ]);

    for (const f of personFields) {
      if (skip.has(f.name) || f.name.startsWith('_')) continue;
      const tn = f.type?.name || f.type?.kind || '';
      if (tn === 'String') {
        fields.push({ name: f.name, label: labelize(f.name), type: 'TEXT' });
      } else if (f.type?.enumValues?.length) {
        fields.push({
          name: f.name, label: labelize(f.name), type: 'SELECT',
          options: f.type.enumValues.map((e: any) => ({
            value: e.name, label: labelize(e.name),
          })),
        });
      } else if (tn === 'Boolean') {
        fields.push({
          name: f.name, label: labelize(f.name), type: 'BOOLEAN',
          options: [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ],
        });
      }
    }

    return fields.length ? fields : DEFAULT_FIELDS;
  } catch {
    return DEFAULT_FIELDS;
  }
}

export async function discoverRelationOptions(
  graphqlUrl: string, token: string, plural: string
): Promise<FieldOption[]> {
  try {
    const data = await gqlReq(graphqlUrl, token,
      'query { ' + plural + '(first: 50) { edges { node { id name } } } }'
    );
    const edges = data.data?.[plural]?.edges || [];
    return edges.map((e: any) => ({
      value: e.node.id, label: e.node.name,
    }));
  } catch { return []; }
}

function labelize(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

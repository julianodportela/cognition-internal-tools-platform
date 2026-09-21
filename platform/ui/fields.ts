import type { ZodObject, ZodRawShape } from 'zod';
import { z } from 'zod';

/**
 * Serializable field descriptors for ActionForm. Server components must build
 * fields on the server (fieldsFromSchema) and pass plain data to the client —
 * a Zod schema object itself cannot cross the server→client boundary.
 */
export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** 'money' renders a dollars input; the value is submitted as integer cents. */
  format?: 'money';
}

function zodKind(t: z.ZodType): FieldDef['type'] {
  let inner: z.ZodType = t;
  for (;;) {
    const def = (inner as z.ZodType & { _def: { type?: string; innerType?: z.ZodType } })._def;
    if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default' || def.type === 'readonly') {
      inner = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === 'number' || def.type === 'int') return 'number';
    if (def.type === 'boolean') return 'checkbox';
    if (def.type === 'enum') return 'select';
    return 'text';
  }
}

// amountCents → 'Amount cents', employeeEmail → 'Employee email'
function humanLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldsFromSchema(
  schema: ZodObject<ZodRawShape>,
  labels?: Record<string, string>,
): FieldDef[] {
  const shape = schema.shape;
  return Object.entries(shape).map(([name, t]) => {
    const def = (t as z.ZodType & { _def: { type?: string; values?: string[] } })._def;
    const type = zodKind(t as z.ZodType);
    const required = def.type !== 'optional' && def.type !== 'default';
    const options =
      type === 'select' && def.values
        ? (def.values as string[]).map((v) => ({ value: v, label: v }))
        : undefined;
    return {
      name,
      label: labels?.[name] ?? humanLabel(name),
      type,
      options,
      required,
      format: name.endsWith('Cents') ? 'money' : undefined,
    };
  });
}

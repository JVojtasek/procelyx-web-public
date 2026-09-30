// Strict validator for the JSON Schema subset used in schemas/*.json (no dependency, runs in Workers Builds).
// Supported: type, const, enum, pattern, minLength, maxLength, minimum, maximum, properties, required,
// additionalProperties (false or schema), patternProperties, propertyNames, items, minItems, maxItems,
// uniqueItems, $ref to "#/$defs/…". Unknown keywords are an error, so a schema cannot silently weaken.
const KNOWN = new Set(['$schema', '$id', '$defs', 'title', 'description', '$comment', 'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'items', 'minItems', 'maxItems',
  'uniqueItems', '$ref']);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

export function validate(schema, value, root = schema, path = '$', errors = []) {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`schema keyword not supported: ${k}`);
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root);
    if (!target) throw new Error(`unresolved $ref ${schema.$ref}`);
    return validate(target, value, root, path, errors);
  }
  const t = typeOf(value);
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) { errors.push(`${path}: expected ${types.join('|')}, got ${t}`); return errors; }
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (t === 'string') {
    const len = [...value].length;
    if (schema.minLength != null && len < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && len > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (t === 'integer' || t === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (t === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${path}: items are not unique`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, root, `${path}[${i}]`, errors));
  }
  if (t === 'object') {
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (schema.propertyNames) validate(schema.propertyNames, k, root, `${p} (name)`, errors);
      let matched = false;
      if (schema.properties && k in schema.properties) { matched = true; validate(schema.properties[k], v, root, p, errors); }
      for (const [re, s] of Object.entries(schema.patternProperties || {})) {
        if (new RegExp(re, 'u').test(k)) { matched = true; validate(s, v, root, p, errors); }
      }
      if (!matched) {
        if (schema.additionalProperties === false) errors.push(`${p}: unknown field`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, root, p, errors);
      }
    }
  }
  return errors;
}

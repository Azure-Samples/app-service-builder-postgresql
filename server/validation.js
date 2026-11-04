function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function positiveInteger(value, name, max = 2147483647) {
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) {
    throw invalid(`${name} must be a positive integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw invalid(`${name} exceeds ${max}`);
  return number;
}

function pagination(query, defaultLimit) {
  const page = positiveInteger(query.page ?? 1, 'page', 100000);
  const limit = positiveInteger(query.limit ?? defaultLimit, 'limit', 100);
  return { page, limit, offset: (page - 1) * limit };
}

function text(value, name, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw invalid(`${name} must be text of at most ${max} characters`);
  return value;
}

module.exports = { positiveInteger, pagination, text };

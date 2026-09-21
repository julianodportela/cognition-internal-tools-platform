// Violates: no-env + no-dangerous-globals (process identifier).
export const secret = process.env.SECRET;

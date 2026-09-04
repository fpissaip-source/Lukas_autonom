export const db = new Proxy({}, { get: () => () => ({}) });
export default new Proxy({}, { get: () => () => ({}) });
export const logger = { info(){},warn(){},error(){},debug(){} };

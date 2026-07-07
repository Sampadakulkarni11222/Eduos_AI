// Flattens a Role document's permissions array into { [permissionKey]: scope }
export const buildPermissionMap = (role) => {
  const map = {};
  for (const p of role?.permissions ?? []) map[p.key] = p.scope;
  return map;
};

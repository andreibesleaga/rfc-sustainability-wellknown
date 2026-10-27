/** The fixed keys. Test key 1 is RFC 8032 section 7.1 test 1; its private half is public. */
export const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromHex = (h) => Buffer.from(h, "hex");

export const KEY1 = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  pub: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
};
/** RFC 8032 section 7.1 test 2, used only where a second key is needed (rotation, former key, other network). */
export const KEY2 = {
  seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
  pub: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
};
export const jwkOf = (key) => ({ kty: "OKP", crv: "Ed25519", x: b64u(fromHex(key.pub)) });

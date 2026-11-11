export async function update(store, key, initial, apply) {
  // Compare-and-swap makes every mutation atomic across concurrent functions.
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = await store.getWithMetadata(key, {type: 'json', consistency: 'strong'});
    const data = snapshot ? snapshot.data : initial();
    const result = await apply(data);
    const condition = snapshot ? {onlyIfMatch: snapshot.etag} : {onlyIfNew: true};
    const saved = await store.setJSON(key, data, condition);
    if (saved.modified) return result;
  }
  throw Object.assign(new Error('มีผู้ใช้งานพร้อมกัน กรุณาลองอีกครั้ง'), {status: 409});
}

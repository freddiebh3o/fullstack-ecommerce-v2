// src/app/admin/page.tsx
export default async function AdminHome() {
  // optional tiny delay to surface loading.tsx
  await new Promise(r => setTimeout(r, 150)); 
  return <div style={{ padding: 24 }}>✅ Auth OK — Admin shell coming next.</div>;
}
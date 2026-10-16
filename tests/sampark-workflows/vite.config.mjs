import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import {defineConfig} from "vite";
const root=path.dirname(fileURLToPath(import.meta.url));
const local=file=>path.resolve(root,file);
const actions=["@/app/login/actions","@/app/(app)/preferences/actions","@/app/(app)/settings/actions","@/app/(app)/staff/vx-actions","@/app/(app)/teach/tasks/actions","@/app/(app)/teach/tasks/delivery-actions","@/app/(app)/collection/photos/profile-actions","@/vx/shell/view-as-actions","./view-as-actions","@/app/(app)/messages/outbox-actions","@/app/r/[token]/actions"];
export default defineConfig({root,envDir:local("empty-env"),publicDir:local("../../public"),cacheDir:local("../../.test-artifacts/sampark-vite"),define:{"process.env":"{}"},
  plugins:[{name:"refuse-unmocked-server-imports",async load(id){if(id.includes("/src/")&&/\.[cm]?[jt]sx?$/.test(id)){const content=await readFile(id,"utf8");if(/^['"]use server['"];|import ['"]server-only['"]/m.test(content))throw new Error(`Synthetic fixture needs explicit server boundary: ${id}`);}}}],
  resolve:{alias:[...actions.map(find=>({find,replacement:local("actions.js")})),
    {find:"@/vx/screens/family-contact/actions",replacement:local("../mobile-ui/student-actions.ts")},
    {find:"@/vx/screens/notes/actions",replacement:local("../mobile-ui/student-actions.ts")},
    {find:"next/navigation",replacement:local("../mobile-ui/navigation.ts")},
    {find:"next/link",replacement:local("../mobile-ui/link.tsx")},
    {find:"next/image",replacement:local("../mobile-ui/image.tsx")},
    {find:"@",replacement:local("../../src")} ]},server:{host:"127.0.0.1",port:3230,strictPort:true}});

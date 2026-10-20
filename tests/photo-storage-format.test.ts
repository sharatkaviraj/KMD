import {expect,it,vi} from "vitest";
const decode=vi.hoisted(()=>vi.fn(()=>({metadata:async()=>({format:"svg"})})));
vi.mock("server-only",()=>({}));
vi.mock("sharp",()=>({default:decode}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:vi.fn()}));
import {preparePhoto} from "@/modules/collection/data/photo-storage";
it.each(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>','<?xml version="1.0"?><svg/>','GIF89a'])('rejects unsupported upload bytes before the image decoder: %s',async source=>{
  decode.mockClear();expect(await preparePhoto(new TextEncoder().encode(source).buffer)).toBe("wrong_type");expect(decode).not.toHaveBeenCalled();
});

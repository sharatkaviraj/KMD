import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { cleanIdentity, type CertificateIdentity } from "../domain/identity";

export const IDENTITY_KEY = "certificate_identity";

export async function readCertificateIdentity(): Promise<CertificateIdentity> {
  await assertPermission("certificates:view");
  const { data, error } = await createAdminClient().from("school_settings").select("value").eq("key", IDENTITY_KEY).maybeSingle<{ value: unknown }>();
  if (error) throw new Error("Certificate settings unavailable");
  return cleanIdentity(data?.value);
}

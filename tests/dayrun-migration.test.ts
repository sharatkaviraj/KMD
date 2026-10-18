import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql=readFileSync('supabase/migrations/20261018191000_overnight_qa_app_sessions.sql','utf8');
describe('app-only migration has bounded object scope',()=>{
 it('creates only four private registries',()=>{expect([...sql.matchAll(/create table\s+([\w.]+)/gi)].map(m=>m[1])).toEqual(['vppsone.qa_dayrun_runs','vppsone.qa_dayrun_accounts','vppsone.qa_dayrun_pairs','vppsone.qa_dayrun_sessions']);});
 it('never replaces an existing helper or adds a policy',()=>{expect(sql).not.toMatch(/create\s+or\s+replace|create\s+policy/i);});
 it('has eleven new scoped functions',()=>{const names=[...sql.matchAll(/create function\s+([\w.]+)/gi)].map(m=>m[1]);expect(names).toHaveLength(11);expect(names.every(n=>n.startsWith('vppsone.qa_dayrun_'))).toBe(true);});
 it('has no schema-wide catalog ACL wildcard',()=>{expect(sql).not.toMatch(/proname\s+like|grant\s+.*all\s+(tables|functions)\s+in\s+schema/i);expect(sql).toContain("signature::regprocedure");});
 it('never mutates original school or auth data',()=>{expect(sql).not.toMatch(/(?:insert into|update|delete from|alter table)\s+(?:auth\.|public\.|storage\.|vppsone\.(?!qa_dayrun_|%I))/i);});
 it('fixed run starts disabled',()=>{expect(sql).toMatch(/enabled boolean not null default false/);expect(sql).toContain("check(expires_at='2026-10-19T07:00:00Z'::timestamptz)");});
 it('existing six only, never new teacher identities',()=>{expect(sql).toContain("check(not is_new)");expect(sql).not.toContain('teacher03');});
 it('unregistered existing sessions retain ordinary access',()=>{expect(sql).toContain('if not found then return true; end if;');});
 it('private registries expose select only to service role',()=>{expect(sql).toContain("revoke all on vppsone.%I from public, anon, authenticated, service_role");expect(sql).toContain("grant select on vppsone.%I to service_role");});
 it('keeps tombstones and never deletes profiles',()=>{expect(sql).toContain('tombstones must never be deleted');expect(sql).toContain('Existing profiles are never deactivated.');});
 it('binds each pair to exact target origin and secret',()=>{expect(sql).toContain('p_target_origin');expect(sql).toContain('secret_hash=p_secret_hash');expect(sql).toContain("status in('consuming','used')");});
 it('uses one transaction with bounded lock timeout',()=>{expect(sql).toMatch(/\nbegin;/);expect(sql.trim()).toMatch(/commit;$/);expect(sql).toContain("lock_timeout = '5s'");});
});

/**
 * Every WhatsApp template VPPS One can send, read from the app's own
 * descriptors, printed as the SQL that seeds `vppsone.whatsapp_templates`.
 *
 *   node --conditions=react-server --import ./scripts/alias-hook.mjs \
 *     scripts/whatsapp-template-catalog.mjs > /tmp/catalog.sql
 *
 * The registry is where a template's approval on the school's own number
 * (+91 83022 07823) lives. The descriptors say what a template says; the
 * registry says whether Meta has approved it there, under which name and
 * language. Every row starts `not_submitted`: templates are approved per
 * WhatsApp Business Account, so nothing approved on the fees app's AiSensy
 * account carries over.
 *
 * One's own staff and collection templates are not listed here: the migration
 * copies them from `vppsone.message_templates`, which already holds their
 * variables and buttons. `tests/whatsapp-template-catalog.test.ts` holds the
 * migration's seed to this list.
 */

import "./alias-hook.mjs";

const { catalogRows } = await import("../src/modules/whatsapp/domain/template-catalog.ts");

const quote = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const array = (values) => `array[${values.map(quote).join(", ")}]::text[]`;

const rows = catalogRows();
const lines = rows.map(
  (row) =>
    `  (${quote(row.key)}, ${quote(row.key)}, ${quote(row.languageCode)}, ${quote(row.feature)}, ${row.bodyParams}, ${array(row.paramNames)}, ${quote(row.header)}, ${row.urlButton}, ${quote(row.labelEn)})`,
);

process.stdout.write(
  `insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en) values\n${lines.join(",\n")}\non conflict (key) do nothing;\n`,
);

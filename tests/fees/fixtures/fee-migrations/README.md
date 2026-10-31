# Fee migrations the ported WhatsApp tests read

Copied unchanged from the fees app (`veerpatta/schoolfees` at `8a0cd47c`,
`supabase/migrations/`). Nothing applies them from here: the fee schema in
One's database came across with the fee app's own history, and
`npm run verify:fee-parity` holds it. The ported tests read these files only to
pin what the code sends against the constraints the fee schema declares
(campaign names, cadence values, the receipt-notice claim), exactly as they do
in the fees app.

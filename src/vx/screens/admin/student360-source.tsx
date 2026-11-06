"use client";

import Link from "@/vx/ui/link";
import type { ReactNode } from "react";
import type { BridgeWorkspace } from "@/platform/fees-bridge/student-read-contracts";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { dateLabel, rupees } from "@/vx/format";

const W={
  identity:p("Identity","पहचान"),school:p("School record","स्कूल रिकॉर्ड"),address:p("Address","पता"),family:p("Family and contacts","परिवार और संपर्क"),
  notes:p("Office notes","कार्यालय की टिप्पणियाँ"),history:p("Record history","रिकॉर्ड का इतिहास"),created:p("Created","बनाया गया"),updated:p("Last updated","अंतिम बदलाव"),
  ledger:p("Payment ledger","भुगतान खाता"),adjustments:p("Payment adjustments","भुगतान में सुधार"),financeHistory:p("Corrections, refunds and waivers","सुधार, धन-वापसी और माफ़ी"),
  emi:p("Monthly EMI plan","मासिक EMI योजना"),planHistory:p("Earlier EMI plans","पिछली EMI योजनाएँ"),covered:p("Charges covered by the plan","योजना में शामिल शुल्क"),
  profile:p("Fee profile and concessions","फ़ीस प्रोफ़ाइल और रियायतें"),financialDetails:p("All fee amounts","फ़ीस की पूरी राशि"),household:p("Household contact record","परिवार का संपर्क रिकॉर्ड"),
  noRows:p("No records in this section.","इस भाग में कोई रिकॉर्ड नहीं है।"),previous:p("Previous","पिछला"),next:p("Next","अगला"),
  page:(n:number,total:number):Pair=>p(`Page ${n} · ${total} records`,`पेज ${n} · ${total} रिकॉर्ड`),
  current:p("Current","वर्तमान"),paid:p("Paid","जमा"),remaining:p("Remaining","बाकी"),lateFee:p("Late fee remaining","बाकी लेट फ़ीस"),waived:p("Late fee waived","माफ़ लेट फ़ीस"),
  amount:p("Amount","राशि"),reason:p("Reason","कारण"),reference:p("Reference","संदर्भ"),by:p("Recorded by","दर्ज करने वाले"),date:p("Date","तारीख"),status:p("Status","स्थिति"),
  review:p("This plan needs review in Fees.","इस योजना की Fees में समीक्षा ज़रूरी है।"),pause:p("Messages paused until","संदेश रुके रहने की तारीख"),
  noContact:p("No usable household contact is recorded.","परिवार का कोई उपयोग योग्य संपर्क दर्ज नहीं है।"),needsReview:p("Contact review required","संपर्क की समीक्षा ज़रूरी है"),
  call:p("Calls available","कॉल उपलब्ध"),whatsapp:p("WhatsApp available","WhatsApp उपलब्ध"),unavailable:p("Unavailable","उपलब्ध नहीं"),
  none:p("none yet","अभी कोई नहीं"),concessions:p("Applicable concessions","लागू रियायतें"),
  noConcessions:p("No concession or special fee setting applies to this student.","इस विद्यार्थी पर कोई रियायत या विशेष फ़ीस सेटिंग लागू नहीं है।"),
  howWorked:p("How this fee is worked out (every setting)","यह फ़ीस कैसे बनी (सभी सेटिंग)"),doNotCall:p("Do not call","कॉल न करें"),
  whatsappPaused:p("WhatsApp paused until","WhatsApp रुका रहेगा"),contactPrefs:p("Contact preferences","संपर्क की प्राथमिकताएँ"),
  followUp:p("Collection follow-up","वसूली का फ़ॉलो-अप"),
};
type Row=[Pair,ReactNode];
const blank=(value:ReactNode)=>value===null||value===undefined||value===""||value==="—";
/** `hideEmpty`: leave out rows with nothing to say — the record keeps them; the screen does not repeat "—" (P05/P06). */
function Rows({rows,hideEmpty=false}:{rows:Row[];hideEmpty?:boolean}) {const {tx}=useVx();const shown=hideEmpty?rows.filter(([,value])=>!blank(value)):rows;if(hideEmpty&&shown.length===0)return null;return <dl className="s360-source-dl">{shown.map(([label,value])=><div key={label.en}><dt>{tx(label)}</dt><dd>{blank(value)?"—":value}</dd></div>)}</dl>;}
function Block({title,children,section}:{title:Pair;children:ReactNode;section?:string}) {const {tx}=useVx();return <section className="card s360-source-section" data-student-source-section={section}><h3>{tx(title)}</h3>{children}</section>;}
function Record({title,children}:{title:string;children:ReactNode}) {return <article className="s360-source-record"><h4>{title}</h4>{children}</article>;}
const shownDate=(value:string|null)=>value?dateLabel(value):null;
const shownTime=(value:string|null)=>value?new Date(value).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}):null;
const HISTORY_KEYS=["contacts","attempts","reminders","notices","documents"] as const;
const FINANCE_DETAIL_LABELS:Record<string,Pair>={
  quick_discount_amount:p("Additional discount","अतिरिक्त रियायत"),quick_late_fee_waiver_amount:p("Late fee waiver","लेट फ़ीस माफ़ी"),
  refund_date:p("Refund date","धन-वापसी की तारीख"),refund_method:p("Refund method","धन-वापसी का तरीका"),refund_reference:p("Refund reference","धन-वापसी संदर्भ"),
  approval_note:p("Approval note","स्वीकृति की टिप्पणी"),processing_note:p("Processing note","प्रक्रिया की टिप्पणी"),approved_at:p("Approved at","स्वीकृति का समय"),processed_at:p("Processed at","प्रक्रिया का समय"),
  waived_at:p("Waived at","माफ़ी का समय"),waived_by_label:p("Waived by","माफ़ करने वाले"),voided_at:p("Voided at","रद्द करने का समय"),void_reason:p("Void reason","रद्द करने का कारण"),
};
const FINANCE_KINDS:Record<string,Pair>={receipt_adjustment:p("Receipt correction","रसीद में सुधार"),receipt_finance_adjustment:p("Receipt discount / waiver correction","रसीद की रियायत / माफ़ी में सुधार"),refund:p("Refund","धन-वापसी"),waiver:p("Late fee waiver","लेट फ़ीस माफ़ी")};
type HistoryKey=(typeof HISTORY_KEYS)[number];
function pageHref(source:BridgeWorkspace,key:string,next:number,tab:"fees"|"family"="fees") {
  const params=new URLSearchParams({tab,receiptsPage:String(source.pagination.receipts?.page??1),ledgerPage:String(Math.max(source.pagination.ledgerPayments?.page??1,source.pagination.ledgerAdjustments?.page??1)),financePage:String(source.pagination.financeHistory?.page??1)});
  for(const section of HISTORY_KEYS)params.set(`${section}Page`,String(source.history[section]?.pagination.page??1));
  params.set(key,String(next));return `/students/${source.studentId}?${params}`;
}

const PROFILE_FIELDS:ReadonlyArray<{title:Pair;fields:ReadonlyArray<[keyof BridgeWorkspace["student"],Pair]>}>=[
  {title:W.identity,fields:[
    ["gender",p("Gender","लिंग")],["bloodGroup",p("Blood group","रक्त समूह")],["category",p("Category","वर्ग")],["religion",p("Religion","धर्म")],
    ["caste",p("Caste","जाति")],["nationality",p("Nationality","राष्ट्रीयता")],["motherTongue",p("Mother tongue","मातृभाषा")],
    ["aadhaarNo",p("Aadhaar number","आधार नंबर")],["janAadhaarNo",p("Jan Aadhaar number","जन आधार नंबर")],["apaarId",p("APAAR / PEN ID","APAAR / PEN ID")],
  ]},
  {title:W.school,fields:[
    ["admissionNo",p("SR number","SR नंबर")],["fullName",p("Student name","विद्यार्थी का नाम")],["classLabel",p("Class","कक्षा")],["classSessionLabel",p("Session","सत्र")],
    ["rollNo",p("Roll number","रोल नंबर")],["house",p("House","हाउस")],["previousSchool",p("Previous school","पिछला स्कूल")],["tcNumber",p("TC number","TC नंबर")],
    ["boardRegistrationNo",p("Board registration number","बोर्ड पंजीकरण नंबर")],["transportRouteLabel",p("Transport route","बस रूट")],["status",W.status],
  ]},
  {title:W.address,fields:[
    ["address",W.address],["villageCity",p("Village / city","गाँव / शहर")],["tehsil",p("Tehsil","तहसील")],["district",p("District","जिला")],["state",p("State","राज्य")],["pincode",p("PIN code","पिन कोड")],
  ]},
  {title:W.family,fields:[
    ["fatherName",p("Father","पिता")],["fatherPhone",p("Father's phone","पिता का फ़ोन")],["motherName",p("Mother","माता")],["motherPhone",p("Mother's phone","माता का फ़ोन")],["email",p("Email","ईमेल")],
    ["guardianName",p("Guardian","अभिभावक")],["guardianRelation",p("Guardian relation","अभिभावक से संबंध")],["guardianPhone",p("Guardian phone","अभिभावक का फ़ोन")],
    ["emergencyContactName",p("Emergency contact","आपातकालीन संपर्क")],["emergencyContactPhone",p("Emergency phone","आपातकालीन फ़ोन")],
  ]},
];
export function SourceStudentInfo({source}:{source:BridgeWorkspace}) {
  const s=source.student;
  return <div className="s360-source-stack" data-student-source-section="profile">
    {PROFILE_FIELDS.map(group=><Block key={group.title.en} title={group.title}><Rows rows={group.fields.map(([key,label])=>[label,String(s[key]??"")])}/>{group.title===W.school?<Rows rows={[[p("Date of birth","जन्म तिथि"),shownDate(s.dateOfBirth)],[p("Admission date","प्रवेश की तारीख"),shownDate(s.joinedOn)],[p("Date left","स्कूल छोड़ने की तारीख"),shownDate(s.leftOn)]]}/>:null}</Block>)}
    <Block title={W.notes}><p className="s360-source-note">{s.notes||"—"}</p></Block>
    <Block title={W.history}><Rows rows={[[W.created,shownTime(s.createdAt)],[W.updated,shownTime(s.updatedAt)]]}/></Block>
  </div>;
}

type PageKey=keyof BridgeWorkspace["pagination"];
export function SourcePages({source,section}:{source:BridgeWorkspace;section:PageKey}) {
  const {tx}=useVx();const page=source.pagination[section];if(!page||page.totalCount<=page.pageSize)return null;
  const key=section==="receipts"?"receiptsPage":section==="financeHistory"?"financePage":"ledgerPage";
  const href=(next:number)=>pageHref(source,key,next);
  return <nav className="s360-source-pages" aria-label={tx(W.page(page.page,page.totalCount))}>
    {page.page>1?<Link prefetch={false} className="tap btn sec" href={href(page.page-1)}>{tx(W.previous)}</Link>:null}<span>{tx(W.page(page.page,page.totalCount))}</span>{page.hasMore?<Link prefetch={false} className="tap btn sec" href={href(page.page+1)}>{tx(W.next)}</Link>:null}
  </nav>;
}

function planRows(plan:NonNullable<BridgeWorkspace["repaymentPlan"]>["summary"]):Row[] {return [
  [W.status,`${plan.lifecycle} · ${plan.paymentStatus}`],[p("Scope","दायरा"),plan.scope],[p("Opening balance","शुरुआती बकाया"),rupees(plan.openingBalance)],
  [p("Monthly amount","मासिक राशि"),rupees(plan.monthlyAmount)],[p("First due date","पहली देय तारीख"),shownDate(plan.firstDueDate)],[p("Term (months)","अवधि (महीने)"),plan.termMonths],
  [p("Final installment","आखिरी किस्त"),rupees(plan.finalInstallmentAmount)],[p("End date","अंतिम तारीख"),shownDate(plan.endDate)],
  [W.paid,rupees(plan.paidToDate)],[W.remaining,rupees(plan.remainingBalance)],[p("Expected by today","आज तक देय"),rupees(plan.expectedToDate)],
  [p("Catch-up amount","समय पर आने के लिए राशि"),rupees(plan.catchUpAmount)],[p("Missed installments","छूटी किस्तें"),plan.missedInstallmentCount],[p("Paid installments","जमा किस्तें"),plan.paidInstallmentCount],
  [W.waived,rupees(plan.waivedLateFeeTotal)],[p("Next due date","अगली देय तारीख"),shownDate(plan.nextDueDate)],[p("Next amount","अगली राशि"),plan.nextDueAmount===null?null:rupees(plan.nextDueAmount)],
  [W.reason,plan.reason],[p("Activated","शुरू किया गया"),shownDate(plan.activatedAt)],[W.by,plan.activatedByLabel],[p("Cancelled","रद्द किया गया"),shownDate(plan.cancelledAt)],[p("Cancellation reason","रद्द करने का कारण"),plan.cancellationReason],
];}

type FeeProfile=NonNullable<BridgeWorkspace["feeProfile"]>;
/** A label is the reader's pair, or a name Fees itself gave (a policy or adjustment head). */
type Applied={label:Pair|string;effect:string|null;reason:string|null};
/**
 * What actually changes this child's fee, each with its effect and reason
 * (review P05). These are settings and explanations, not extra charges; a
 * zero or unset setting is not listed here, and all of them stay one tap away
 * under "How this fee is worked out".
 */
export function appliedConcessions(f:FeeProfile):Applied[] {
  const out:Applied[]=[];
  const before=f.tuitionBeforeConventionalDiscount,after=f.tuitionAfterConventionalDiscount;
  for(const label of f.conventionalDiscountLabels)out.push({label,effect:before!==after?`${rupees(before)} → ${rupees(after)}`:null,reason:[f.conventionalDiscountReason,f.conventionalDiscountFamilyGroupLabel].filter(Boolean).join(" · ")||null});
  if(f.discountAmount>0)out.push({label:p("Additional discount","अतिरिक्त रियायत"),effect:`− ${rupees(f.discountAmount)}`,reason:f.overrideReason});
  if(f.lateFeeWaiverAmount>0)out.push({label:p("Late fee waiver","लेट फ़ीस माफ़ी"),effect:`− ${rupees(f.lateFeeWaiverAmount)}`,reason:f.overrideReason});
  if(f.tuitionOverride!==null)out.push({label:p("Tuition set specially","विशेष शिक्षण शुल्क"),effect:rupees(f.tuitionOverride),reason:f.overrideReason});
  if(f.transportOverride!==null)out.push({label:p("Transport set specially","विशेष परिवहन शुल्क"),effect:rupees(f.transportOverride),reason:f.overrideReason});
  if(f.studentTypeOverride)out.push({label:p("Fee category set specially","विशेष फ़ीस वर्ग"),effect:f.studentTypeOverride,reason:f.overrideReason});
  if(f.otherAdjustmentAmount)out.push({label:f.otherAdjustmentHead||p("Other adjustment","अन्य समायोजन"),effect:rupees(f.otherAdjustmentAmount),reason:f.overrideReason});
  return out;
}
function Concessions({profile}:{profile:FeeProfile}) {
  const {tx}=useVx();const rows=appliedConcessions(profile);
  if(rows.length===0)return <p className="s360-source-note">{tx(W.noConcessions)}</p>;
  return <div className="s360-concessions"><span className="sech">{tx(W.concessions)}</span>
    <ul>{rows.map((row,i)=><li key={i}><span className="s360-con-l">{typeof row.label==="string"?row.label:tx(row.label)}</span>{row.effect?<span className="num s360-con-e">{row.effect}</span>:null}{row.reason?<span className="s360-con-r">{row.reason}</span>:null}</li>)}</ul>
  </div>;
}

export function SourceFeeDetails({source}:{source:BridgeWorkspace}) {
  const {tx}=useVx();const profile=source.feeProfile,financial=source.financialSummary,plan=source.repaymentPlan;
  return <div className="s360-source-stack" data-student-source-section="fees">
    {financial?<details className="card s360-source-section"><summary>{tx(W.financialDetails)}</summary><Rows rows={[
      [p("Tuition","शिक्षण शुल्क"),rupees(financial.tuitionFee)],[p("Transport","परिवहन"),rupees(financial.transportFee)],[p("Academic fee","अकादमिक शुल्क"),rupees(financial.academicFee)],
      [p("Other adjustment","अन्य समायोजन"),`${financial.otherAdjustmentHead??"—"} · ${rupees(financial.otherAdjustmentAmount)}`],
      [p("Before discounts","रियायत से पहले"),rupees(financial.grossBaseBeforeDiscount)],[p("Policy discount","नीति की रियायत"),rupees(financial.conventionalDiscountAmount)],
      [p("Additional discount","अतिरिक्त रियायत"),rupees(financial.studentDiscountAmount)],[p("Discount close-out","रियायत से बंद बकाया"),rupees(financial.discountClosedAmount)],
      [p("Fee charged","दर्ज फ़ीस"),rupees(financial.baseChargeTotal)],[W.paid,rupees(financial.totalPaid)],[p("Fee remaining","बाकी फ़ीस"),rupees(financial.baseOutstandingAmount)],
      [p("Late fee charged","दर्ज लेट फ़ीस"),rupees(financial.lateFeeTotal)],[W.waived,rupees(financial.lateFeeWaiverAmount)],[W.lateFee,rupees(financial.lateFeeOutstandingAmount)],
      [p("Total collectible","कुल जमा करने योग्य"),rupees(financial.totalOwedAmount)],[p("Credit balance","अग्रिम शेष"),source.financialSnapshot?rupees(source.financialSnapshot.creditBalance):null],
      [p("Refundable amount","वापस करने योग्य राशि"),source.financialSnapshot?rupees(source.financialSnapshot.refundableAmount):null],
    ]}/></details>:null}
    {profile?<Block title={W.profile} section="concessions"><Concessions profile={profile}/>
      <details className="s360-fold-inner"><summary>{tx(W.howWorked)}</summary><Rows hideEmpty rows={[
        [p("Student fee category","विद्यार्थी का फ़ीस वर्ग"),profile.studentStatusLabel],[p("Category override","विशेष फ़ीस वर्ग"),profile.studentTypeOverride],[p("Tuition override","विशेष शिक्षण शुल्क"),profile.tuitionOverride===null?null:rupees(profile.tuitionOverride)],
        [p("Transport override","विशेष परिवहन शुल्क"),profile.transportOverride===null?null:rupees(profile.transportOverride)],[p("Additional discount","अतिरिक्त रियायत"),rupees(profile.discountAmount)],
        [p("Configured late fee waiver","तय लेट फ़ीस माफ़ी"),rupees(profile.lateFeeWaiverAmount)],[p("Other adjustment","अन्य समायोजन"),profile.otherAdjustmentAmount===null?null:`${profile.otherAdjustmentHead??"—"} · ${rupees(profile.otherAdjustmentAmount)}`],
        [W.reason,profile.overrideReason],[W.notes,profile.overrideNotes],[p("Policy concessions","नीति की रियायतें"),profile.conventionalDiscountLabels.join(", ")],
        [p("Concession reason","रियायत का कारण"),profile.conventionalDiscountReason],[p("Concession notes","रियायत की टिप्पणियाँ"),profile.conventionalDiscountNotes],
        [p("Concession family","रियायत वाला परिवार"),profile.conventionalDiscountFamilyGroupLabel],[p("Manual eligibility reason","विशेष पात्रता का कारण"),profile.conventionalDiscountManualOverrideReason],
        [p("Tuition before policy","नीति से पहले शिक्षण शुल्क"),rupees(profile.tuitionBeforeConventionalDiscount)],[p("Tuition after policy","नीति के बाद शिक्षण शुल्क"),rupees(profile.tuitionAfterConventionalDiscount)],
      ]}/></details>
    </Block>:null}
    {plan?<Block title={W.emi} section="emi">{plan.summary.planReviewNeeded?<p>{tx(W.review)}</p>:null}<Rows rows={planRows(plan.summary)}/>
      {plan.schedule.map(row=><Record key={row.sequenceNo} title={`${row.sequenceNo} · ${dateLabel(row.dueDate)}`}><Rows rows={[[W.amount,rupees(row.amount)],[W.paid,rupees(row.paidAmount)],[W.status,row.status],...(row.lateFee?[[W.lateFee,rupees(row.lateFee.outstandingAmount)],[W.waived,rupees(row.lateFee.waivedAmount)]] as Row[]:[])]}/></Record>)}
      <details><summary>{tx(W.covered)}</summary>{plan.items.map(row=><Record key={row.installmentId} title={row.installmentLabel||String(row.installmentNo??"—")}><Rows rows={[[W.date,shownDate(row.dueDate)],[W.amount,rupees(row.snapshotBaseCharge)],[W.remaining,rupees(row.includedBaseBalance)],[W.waived,rupees(row.waivedLateFee)]]}/></Record>)}</details>
    </Block>:source.permissions.fees?<Block title={W.emi} section="emi"><p>{tx(p("No active EMI plan.","कोई सक्रिय EMI योजना नहीं है।"))}</p></Block>:null}
    {source.repaymentPlanHistory?.length?<Block title={W.planHistory}>{source.repaymentPlanHistory.map(row=><details key={row.planId}><summary>{dateLabel(row.activatedAt)} · {row.lifecycle}</summary><Rows rows={planRows(row)}/></details>)}</Block>:null}
    {source.permissions.ledger&&source.ledger?<>
      <Block title={W.ledger} section="ledger">{source.ledger.payments.length===0?<p>{tx(W.noRows)}</p>:source.ledger.payments.map(row=><Record key={row.id} title={`${row.receiptNumber} · ${dateLabel(row.paymentDate)}`}><Rows rows={[
        [W.amount,rupees(row.paymentAmount)],[p("Payment mode","भुगतान का तरीका"),row.paymentMode],[p("Installment","किस्त"),row.installmentLabel],[p("Due date","देय तारीख"),shownDate(row.dueDate)],
        [W.reference,row.referenceNumber],[W.by,row.receivedBy],[W.notes,row.notes],[p("Adjustments","सुधार"),`${row.adjustmentCount} · ${rupees(row.adjustmentNetDelta)}`],
      ]}/></Record>)}<SourcePages source={source} section="ledgerPayments"/></Block>
      <Block title={W.adjustments}>{source.ledger.adjustments.length===0?<p>{tx(W.noRows)}</p>:source.ledger.adjustments.map(row=><Record key={row.id} title={`${row.receiptNumber} · ${dateLabel(row.createdAt)}`}><Rows rows={[[W.amount,rupees(row.amountDelta)],[W.status,row.adjustmentType],[p("Installment","किस्त"),row.installmentLabel],[W.reason,row.reason],[W.notes,row.notes],[W.by,row.createdByName]]}/></Record>)}<SourcePages source={source} section="ledgerAdjustments"/></Block>
    </>:null}
    {source.financeHistory?<Block title={W.financeHistory}>{source.financeHistory.length===0?<p>{tx(W.noRows)}</p>:source.financeHistory.map(row=><Record key={`${row.kind}:${row.id}`} title={`${tx(FINANCE_KINDS[row.kind])} · ${shownTime(row.createdAt)}`}><Rows rows={[[W.amount,row.amount===null?null:rupees(row.amount)],[W.status,row.status],[W.reason,row.reason],[W.notes,row.notes],...Object.entries(row.details).filter(([key])=>key in FINANCE_DETAIL_LABELS).map(([key,value]):Row=>[FINANCE_DETAIL_LABELS[key],typeof value==="number"?rupees(value):value]) ]}/></Record>)}<SourcePages source={source} section="financeHistory"/></Block>:null}
    <SourceDocuments source={source}/>
  </div>;
}

/**
 * The household's contacts as compact cards (review P06): the number, who it
 * belongs to and which channels Fees allows. A pause, a review flag or "no
 * usable contact" stays in plain sight — none of it is folded away. "Calls
 * available" is what Fees allows, not consent or a delivered message.
 */
export function SourceHousehold({source}:{source:BridgeWorkspace}) {
  const {tx}=useVx();const household=source.household;if(!source.permissions.household||!household)return null;
  return <Block title={W.household} section="household">
    {household.familyLabel?<p className="s360-source-note">{household.familyLabel}</p>:null}
    {household.pausedUntil?<p className="s360-restrict">{tx(W.pause)} {shownDate(household.pausedUntil)}</p>:null}
    {household.reviewRequired?<p className="s360-restrict">{tx(W.needsReview)}</p>:null}
    {household.noContact?<p className="s360-restrict">{tx(W.noContact)}</p>:null}
    {household.contacts.length?<ul className="s360-contacts">{household.contacts.map((row,i)=><li key={`${row.destination}:${i}`}>
      <span className="num s360-contact-n">{row.destination}</span>
      {row.labels.length?<span className="s360-contact-who">{row.labels.join(", ")}</span>:null}
      <span className="s360-contact-ch">
        {row.telephoneEligible?<span className="pill s360-ch-ok">{tx(W.call)}</span>:null}
        {row.whatsappEligible?<span className="pill s360-ch-ok">{tx(W.whatsapp)}</span>:null}
        {!row.telephoneEligible&&!row.whatsappEligible?<span className="pill s360-ch-no">{tx(W.unavailable)}{row.unavailableCause?` · ${row.unavailableCause}`:""}</span>:null}
      </span>
    </li>)}</ul>:null}
  </Block>;
}

function HistoryPages({source,section,tab="family"}:{source:BridgeWorkspace;section:HistoryKey;tab?:"family"|"fees"}) {
  const {tx}=useVx();const page=source.history[section]?.pagination;if(!page||page.totalCount<=page.pageSize)return null;
  return <nav className="s360-source-pages" aria-label={tx(W.page(page.page,page.totalCount))}>
    {page.page>1?<Link prefetch={false} className="tap btn sec" href={pageHref(source,`${section}Page`,page.page-1,tab)}>{tx(W.previous)}</Link>:null}
    <span>{tx(W.page(page.page,page.totalCount))}</span>
    {page.hasMore?<Link prefetch={false} className="tap btn sec" href={pageHref(source,`${section}Page`,page.page+1,tab)}>{tx(W.next)}</Link>:null}
  </nav>;
}

/**
 * Contact and message history, compact (review P06). Restrictions — do not
 * call, WhatsApp paused — are always shown. Each history is one line with its
 * count that opens to the full records (opened already when a page of it was
 * asked for); sections with nothing recorded share one line instead of each
 * drawing an empty box. Nothing is merged, relabelled or dropped.
 */
export function SourceFamilyHistory({source}:{source:BridgeWorkspace}) {
  const {tx}=useVx();const h=source.history,flags=h.collectionFlags,recovery=h.recovery;
  const paged=(section:HistoryKey)=>(h[section]?.pagination.page??1)>1;
  const messageRows=(section:"reminders"|"notices")=>h[section]!.rows.map(row=><Record key={row.id} title={`${row.kind??row.campaign??"—"} · ${shownTime(row.createdAt)}`}><Rows hideEmpty rows={[
    [W.status,row.status],[p("Destination","भेजा गया संपर्क"),row.destination],[p("Recipient role","प्राप्तकर्ता का संबंध"),row.destinationRole],[p("Language","भाषा"),row.language],[p("Sent","भेजा गया"),shownTime(row.sentOn)],
    [p("Delivery status","पहुँचने की स्थिति"),row.deliveryStatus],[p("Delivered","पहुँचा"),shownTime(row.deliveredAt)],[p("Read","पढ़ा गया"),shownTime(row.readAt)],
    [p("Attempts","प्रयास"),row.attempts],[p("Last attempt","अंतिम प्रयास"),shownTime(row.lastAttemptAt)],[p("Failure reason","विफलता का कारण"),row.failureCause],
    [p("Resolution","समाधान"),row.resolution],[p("Resolution notes","समाधान की टिप्पणियाँ"),row.resolutionNote],[p("Resolved","समाधान हुआ"),shownTime(row.resolvedAt)],[p("Due amount","देय राशि"),row.dueAmount===null?null:rupees(row.dueAmount)],[W.updated,shownTime(row.updatedAt)],
  ]}/></Record>);
  const sections:{key:HistoryKey;title:Pair;body:()=>ReactNode}[]=[
    {key:"contacts",title:p("Contact history in Fees","Fees में संपर्क का इतिहास"),body:()=>h.contacts!.rows.map(row=><Record key={row.id} title={shownTime(row.contactedAt)??"—"}><Rows hideEmpty rows={[
      [p("Channel","माध्यम"),row.channel],[p("Outcome","परिणाम"),row.outcome],[p("Phone","फ़ोन"),row.contactedPhone],[p("Contact label","संपर्क का नाम"),row.phoneLabel],
      [W.notes,row.note],[p("Snoozed until","रुके रहने की तारीख"),shownDate(row.snoozeUntil)],[p("Broadcast","प्रसारण"),row.broadcast?tx(p("Yes","हाँ")):null],
      ...(row.hasVoiceNote?[[p("Voice note","वॉइस नोट"),tx(p("Available in Fees","Fees में उपलब्ध"))]] as Row[]:[]),
    ]}/></Record>)},
    {key:"reminders",title:p("Fee reminders","फ़ीस अनुस्मारक"),body:()=>messageRows("reminders")},
    {key:"notices",title:p("Notices","सूचनाएँ"),body:()=>messageRows("notices")},
    {key:"attempts",title:p("Message attempts","संदेश भेजने के प्रयास"),body:()=>h.attempts!.rows.map(row=><Record key={row.id} title={shownTime(row.createdAt)??"—"}><Rows hideEmpty rows={[[W.status,row.result],[p("Destination","भेजा गया संपर्क"),row.destination],[p("Recipient role","प्राप्तकर्ता का संबंध"),row.destinationRole],[p("Workflow","कार्य"),row.source],[W.reason,row.cause],[W.notes,row.note]]}/></Record>)},
  ];
  const readable=sections.filter(section=>h[section.key]);
  const empty=readable.filter(section=>h[section.key]!.pagination.totalCount===0);
  return <div className="s360-source-stack" data-student-source-section="history">
    {flags?.noCall?<p className="s360-restrict">{tx(W.doNotCall)}{flags.reason?` · ${flags.reason}`:""}</p>:null}
    {flags?.whatsappSnoozedUntil?<p className="s360-restrict">{tx(W.whatsappPaused)} {shownDate(flags.whatsappSnoozedUntil)}</p>:null}
    {flags?<details className="card s360-source-section s360-fold"><summary><span>{tx(W.contactPrefs)}</span></summary><Rows hideEmpty rows={[
      [W.doNotCall,tx(flags.noCall?p("Yes","हाँ"):p("No","नहीं"))],[W.reason,flags.reason],[p("WhatsApp frequency","WhatsApp की आवृत्ति"),flags.whatsappCadence],
      [W.pause,shownDate(flags.whatsappSnoozedUntil)],[p("Language","भाषा"),flags.whatsappLanguage],[p("Contact profile","संपर्क प्रोफ़ाइल"),flags.whatsappProfile],[p("Profile set","प्रोफ़ाइल तय हुई"),shownTime(flags.profileSetAt)],[W.updated,shownTime(flags.updatedAt)],
    ]}/></details>:null}
    {recovery?<details className="card s360-source-section s360-fold"><summary><span>{tx(W.followUp)}</span>{recovery.stage?<span className="s360-fold-n">{recovery.stage}</span>:null}</summary><Rows hideEmpty rows={[[p("Stage","चरण"),recovery.stage],[p("Promise outcome","वचन का परिणाम"),recovery.promiseOutcome],[p("Promise resolved","वचन का निपटारा"),shownTime(recovery.promiseResolvedAt)],[p("Promises kept","निभाए गए वचन"),recovery.keptCount],[p("Promises broken","टूटे वचन"),recovery.brokenCount],[W.updated,shownTime(recovery.updatedAt)]]}/></details>:null}
    {readable.filter(section=>!empty.includes(section)).map(section=><details key={section.key} open={paged(section.key)} className="card s360-source-section s360-fold" data-student-source-section={section.key}>
      <summary><span>{tx(section.title)}</span><span className="num s360-fold-n">{h[section.key]!.pagination.totalCount}</span></summary>
      {section.body()}<HistoryPages source={source} section={section.key}/>
    </details>)}
    {empty.length?<p className="s360-source-empty">{empty.map(section=>tx(section.title)).join(" · ")} — {tx(W.none)}</p>:null}
  </div>;
}

function SourceDocuments({source}:{source:BridgeWorkspace}) {
  const {tx}=useVx();const docs=source.history.documents;if(!docs)return null;
  return <Block title={p("Saved receipts and statements","सहेजी गई रसीदें और विवरण")} section="documents">
    <p className="s360-source-note">{tx(p("A stored document may reflect its latest generated version.","सहेजे गए दस्तावेज़ में उसका सबसे नया बनाया गया रूप हो सकता है।"))}</p>
    {docs.rows.length===0?<p>{tx(W.noRows)}</p>:docs.rows.map(row=><Record key={row.sendId} title={`${tx(row.kind==="receipt"?p("Receipt","रसीद"):p("Fee statement","फ़ीस विवरण"))} · ${shownTime(row.createdAt)}`}>
      <Rows rows={[[W.updated,shownTime(row.updatedAt)]]}/>{row.available?<a className="tap btn sec" href={`/api/fees-bridge/students/${source.studentId}/documents/${row.sendId}?${new URLSearchParams({session:source.sessionLabel})}`} target="_blank" rel="noreferrer">{tx(p("Open PDF","PDF खोलें"))}</a>:<span>{tx(W.unavailable)}</span>}
    </Record>)}<HistoryPages source={source} section="documents" tab="fees"/>
  </Block>;
}

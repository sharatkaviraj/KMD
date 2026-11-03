import { defaultStudyTemplate, type CertificateKind, type CertificateTemplate } from "./certificate";

/**
 * The wording the migration seeds for each kind
 * (`20261103031956_school_office_certificate_kinds.sql`). Used for previews
 * and tests; the database row, not this file, is what an issue freezes.
 */
const common = { active: true, language: "en" as const, signaturePolicy: "manual" as const, purposeEn: defaultStudyTemplate.purposeEn, purposeHi: defaultStudyTemplate.purposeHi };

const characterEn = "This is to certify that {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, has been a student of this school in Class {classLabel} during academic session {sessionLabel}. To the best of my knowledge {heShe} bears {conduct} moral character. I wish {himHer} every success in life.";
const characterHi = "प्रमाणित किया जाता है कि {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में इस विद्यालय की कक्षा {classLabel} के विद्यार्थी रहे हैं। मेरी जानकारी के अनुसार इनका चरित्र {conduct} है। इनके उज्ज्वल भविष्य के लिए शुभकामनाएँ।";
const dobEn = "This is to certify that, as recorded in the Scholar's Register of this school, the date of birth of {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, is {dateOfBirth} ({dateOfBirthWords}).";
const dobHi = "प्रमाणित किया जाता है कि इस विद्यालय की छात्र पंजिका (एसआर) के अनुसार {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, की जन्म तिथि {dateOfBirth} ({dateOfBirthWords}) है।";
const tcEn = "Certified that the particulars given below are as recorded in the Scholar's Register of {schoolName}.";
const tcHi = "प्रमाणित किया जाता है कि नीचे दिया गया विवरण {schoolName} की छात्र पंजिका के अनुसार है।";

export const defaultTemplates: Record<CertificateKind, CertificateTemplate> = {
  study: defaultStudyTemplate,
  character: { ...common, version: 2, kind: "character", titleEn: "Character Certificate", titleHi: "चरित्र प्रमाण पत्र", bodyEn: characterEn, bodyHi: characterHi,
    historicalBodyEn: characterEn.replace("has been a student", "was a student"), historicalBodyHi: characterHi,
    requiredFields: ["studentName", "fatherName", "admissionNo", "classLabel", "sessionLabel"], detailRows: [], prefix: "VPPS/CC" },
  dob: { ...common, version: 3, kind: "dob", titleEn: "Date of Birth Certificate", titleHi: "जन्म तिथि प्रमाण पत्र", bodyEn: dobEn, bodyHi: dobHi, historicalBodyEn: dobEn, historicalBodyHi: dobHi,
    requiredFields: ["studentName", "fatherName", "admissionNo", "dateOfBirth"], detailRows: [], prefix: "VPPS/DOB" },
  tc: { ...common, version: 4, kind: "tc", titleEn: "Transfer Certificate", titleHi: "स्थानांतरण प्रमाण पत्र", bodyEn: tcEn, bodyHi: tcHi, historicalBodyEn: tcEn, historicalBodyHi: tcHi,
    requiredFields: ["studentName", "fatherName", "admissionNo", "dateOfBirth", "classLabel", "leftOn"],
    detailRows: ["studentName", "fatherName", "motherName", "dateOfBirth", "dateOfBirthWords", "admissionNo", "admittedOn", "classLabel", "sessionLabel", "lastResult", "leftOn", "reasonForLeaving", "conduct", "remarks"], prefix: "VPPS/TC" },
};

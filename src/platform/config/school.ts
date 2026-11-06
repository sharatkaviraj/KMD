export { schoolBrand } from "./school-brand";

export const schoolProfile = {
  name:
    process.env.NEXT_PUBLIC_SCHOOL_NAME?.trim() ||
    "Shri Veer Patta Senior Secondary School",
  shortName: "Shri Veer Patta SSS",
  // Printed receipt header info. All three default to empty so the receipt
  // gracefully omits the line when the env var is not set; populate via env
  // (`NEXT_PUBLIC_SCHOOL_ADDRESS` / `_PHONE` / `_EMAIL`) without code change.
  address: process.env.NEXT_PUBLIC_SCHOOL_ADDRESS?.trim() ?? "",
  phone: process.env.NEXT_PUBLIC_SCHOOL_PHONE?.trim() ?? "",
  email: process.env.NEXT_PUBLIC_SCHOOL_EMAIL?.trim() ?? "",
  // The number staff call from the teacher screens' "Call the office". Until
  // `NEXT_PUBLIC_SCHOOL_PHONE` is set it is the office number the fee app
  // already gives parents in every WhatsApp message (schoolfees
  // `modules/whatsapp/domain/campaign-bodies*.ts`). Receipts and certificates
  // keep `phone`, which stays empty until the owner sets it.
  officePhone: process.env.NEXT_PUBLIC_SCHOOL_PHONE?.trim() || "9352205884",
  appMode: process.env.APP_MODE?.trim() || "production",
  adminOnly: true,
  receiptPrefix: "SVP",
  staffAudience: "Office and accounts staff",
} as const;


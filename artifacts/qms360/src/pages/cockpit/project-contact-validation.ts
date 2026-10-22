// Keep these rules aligned with the ProjectAdditionalData API contract.
export const PROJECT_EMAIL_PATTERN = "^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$";
export const PROJECT_PHONE_PATTERN = "^\\+[1-9](?:[ -]?[0-9]){6,14}$";
export function projectContactErrors(email: string, phone: string) {
  return {
    email: email.trim() && (email.trim().length > 254 || !new RegExp(PROJECT_EMAIL_PATTERN).test(email.trim()))
      ? "Enter a valid email address, e.g. name@example.com." : "",
    phone: phone.trim() && (phone.trim().length > 32 || !new RegExp(PROJECT_PHONE_PATTERN).test(phone.trim()))
      ? "Include + and the country code, with 7–15 digits in total, e.g. +91 9876543210." : "",
  };
}

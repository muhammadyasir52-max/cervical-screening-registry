// Screening rule parameters. These are illustrative defaults loosely modelled on
// common HPV-primary programmes. They are NOT clinical guidance: a real programme
// must set them from its own national protocol.
export const rules = {
  eligibleAge: { min: 25, max: 64 },
  // Routine recall interval in months, chosen by age at the last screen.
  intervals: [
    { minAge: 25, maxAge: 49, months: 36 },
    { minAge: 50, maxAge: 64, months: 60 },
  ],
  // HPV positive but cytology negative: repeat test after this many months.
  hpvPositiveRepeatMonths: 12,
  // Inadequate sample: retake after this many months.
  inadequateRepeatMonths: 3,
  // Abnormal results with no recorded follow-up after this many days escalate.
  abnormalFollowUpDays: 42,
  // "Due soon" window in days before the due date.
  dueSoonDays: 90,
};

// Public dashboard counts below this are shown as "<5" so that small groups
// cannot be singled out.
export const suppressionThreshold = 5;

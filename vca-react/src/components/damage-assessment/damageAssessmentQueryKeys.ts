export const damageAssessmentCardsKey = (complaintId: string) =>
  ["damage-assessment-cards", complaintId] as const;

export const damageAssessmentCardDetailsKey = (
  complaintId: string,
  cardKey: string
) => ["damage-assessment-card-details", complaintId, cardKey] as const;

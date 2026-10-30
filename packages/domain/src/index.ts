export { isTimezone, timezoneGroups, utcOffset } from "./timezones";
export { classLoad, formatMinutes, lessonMinutes } from "./time";
export type { ClassLoad } from "./time";
export type { TimezoneOption } from "./timezones";
import { isTimezone } from "./timezones";
import { canonicalLocale } from "./preferences";
export { courseAccess, seesSection, teachesSection, maxSectionEducators } from "./access";
export { createsCycle, dependents, maxPrerequisites, prerequisiteInput, prerequisiteStages } from "./prerequisites";
export type { Requirement } from "./prerequisites";
export { maxWorkGroups, nextInPath, pathIndicators, sectionIndicators, wholeSection, workGroupInput } from "./sections";
export type { SectionClass } from "./sections";
export { moduleNavigation } from "./navigation";
export { calendarFeed, escapeText, feedWindow, foldLine, zonedInstant } from "./calendar-feed";
export type { FeedClass } from "./calendar-feed";
export { canonicalJson, documentCanonical, gatedKinds, isLegalKind, legalDraftInput, legalKinds, legalLabels, pendingAgreement, pendingDocuments, signatureCanonical, signedKinds, signedNameInput } from "./legal";
export { organizations, organizationIds, fictional, tokenPrefix, sharePrefix, sectionPrefix, tokenPattern, scopeOfToken, scopeOfShare, scopeOfSection } from "./organizations";
export type { OrganizationId } from "./organizations";
export { accountInput, acceptablePassword, maxPasswordLength, minPasswordLength, temporaryAlphabet, temporaryPassword, usernamePattern } from "./accounts";
export type { AccountRole } from "./accounts";
export { dailyMailCap, emailPattern, invitationDays, invitationInput, invitationLifetimeMs, invitationMessage, invitationState, mailAttempts, mailDecision, normalizeEmail, roleLabel } from "./mail";
export type { InvitationDetails, MailMessage, MailResult, MailSender, MailStatus } from "./mail";
export type { ModuleLesson } from "./navigation";
export { isCalendarDay, weekdays, scheduleInput, scheduleDates, breakInput, breakOn, carryOver, scheduleSummary, lessonsInOrder, periodWeek, classSequence, maxScheduleDays, maxScheduledClasses, meetingOn, meetingsOf } from "./schedule";
export type { ScheduleMeeting, SectionSchedule } from "./schedule";
export { easterSunday, ruleInput, occurrences, nextYearRules, ruleSummary, guatemalaTemplate } from "./calendar-rules";
export { effectiveCalendar, generateYear, noClassDays } from "./institutional-calendar";
export type { CalendarRange, ExistingGeneratedEvent, GeneratedEvent, GenerationPlan, NoClassDay } from "./institutional-calendar";
export { bellBlocks, bellLength, bellScheduleInput, bellTemplates, clockOf, daysText, maxBellPeriods, maxBellSchedules, meetingFromBlocks, minutesOf } from "./bell-schedules";
export type { BellBlock, BellBreak, BellConfig, BellScheduleDraft } from "./bell-schedules";
export { acceptsAttendance, cancelPlanInput, classActions, classPlanInput, classStatusLabels, completionInput, inSessionFilter, lessonOutcomeLabels, maxClassLessons, groupCodePattern, localDay, newGroupCode, nextClassStatus, normalizeGroupCode, sessionFilterAllowed, sessionFilterInput, upcomingClasses } from "./classes";
export type { ClassAction, ClassPlan, SessionFilter } from "./classes";
export { materialInput, record, cleanText, validTermIds, completeOrder } from "./courses";
export { apaBibliography, citation, detectHeadings, indexFromOutline, indexRanges, lookupIdentifier, resourceCoverage, resourceFields, resourceInput, resourceLicenses, resourceRoleLabel, resourceRoles, resourceTypeLabel, resourceTypes } from "./resources";
export type { BibliographyEntry, CitationResource, CoverageMap, IndexEntry, LookupRecord, LookupResult, OutlineNode, ResourceAuthor, ResourceField, ResourceKind, ResourceLicense, ResourceMetadata, ResourceRole, ResourceType } from "./resources";
export { coreCoverage, freedomPolicies, freedomPolicyLabel, policyChange, sectionContent, sectionDifferences } from "./section-freedom";
export type { CoreCoverage, EffectiveActivity, EffectiveLesson, EffectiveUnit, FreedomActivity, FreedomLesson, FreedomOverride, FreedomPolicy, FreedomUnit, SectionContent, SectionDifference, SectionDifferenceSource } from "./section-freedom";
export { educationTypes, educationLevels, knowledgeAreas, areaLabel, courseFormats, modalities, pacings, moduleLabels, moduleNoun, settingDefinitions, derivedSettings, sourceLabel, effectiveProfile, resolveSettings, settingsInput, settingChoices, settingText, settingValue, profileInput, courseInput, programInput, coursePresets, labelOf } from "./academic";
export type { ModuleNoun, SettingKey, SettingSource } from "./academic";
export { sequenceTemplates, sequenceOf, purposes, groupings, blockKinds, blocksOf, phaseOf, studentActivities, resourceIdsOf, richTextFieldsOf, hasText } from "./sequences";
export type { Phase } from "./sequences";
export { cognitiveLevels, competencyInput, outcomeInput, validOutcomeIds, outcomeCodes, activityOutcomes, assesses, lessonOutcomes, coverage, suggestedResources, publishChecklist, outcomeLimit, competencyLimit } from "./outcomes";
export type { Gap, OutcomeCoverage, UnitCoverage, CheckItem } from "./outcomes";
import { validOutcomeIds } from "./outcomes";
/** Name, zone and, optionally (ST-160), the regional format every person follows until they choose their own. */
export function organizationInput(value: unknown): { name: string; timezone: string; locale?: string } | null {
  if (!value || typeof value !== "object") return null;
  const { name, timezone, locale } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof timezone !== "string") return null;
  const clean = name.trim().normalize("NFC");
  if (clean.length < 3 || clean.length > 80 || /[<>\x00-\x1f]/.test(clean)) return null;
  if (!isTimezone(timezone)) return null;
  if (locale === undefined) return { name: clean, timezone };
  const tag = canonicalLocale(locale);
  return tag ? { name: clean, timezone, locale: tag } : null;
}
const purposeValues = new Set(["explain", "explore", "practice", "assess", "reflect"]);
const groupingValues = new Set(["individual", "pairs", "teams", "whole-class"]);
const blockKindValues = new Set(["text", "resource", "question", "teacher-note"]);
const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
function validQuestion(options: unknown, answer: unknown) {
  return Array.isArray(options) && options.length >= 2 && options.length <= 6 && options.every(o => typeof o === "string" && o.trim() && o.length <= 200) && new Set(options).size === options.length && Number.isInteger(answer) && (answer as number) >= 0 && (answer as number) < options.length;
}
function hasBody(item: Record<string, unknown>) {
  const instructions = item.instructions === undefined ? "" : item.instructions;
  if (typeof instructions !== "string" || instructions.length > 4000) return false;
  if (item.richContent !== undefined && !validRichText(item.richContent)) return false;
  return !!instructions.trim() || validRichText(item.richContent);
}
/**
 * Lesson activities. An activity has a title, minutes, an optional moment, purpose and grouping, and either
 * ordered blocks (text, resource, question, teacher note) or the older single typed body.
 */
export function validActivities(input: unknown): boolean {
  if (!Array.isArray(input) || input.length > 30) return false;
  // Activity IDs are unique among activities and block IDs among blocks (they name collaborative fields);
  // the first block of an older activity keeps the activity's ID so its live text is not lost.
  const unique = (seen: Set<string>) => (id: unknown) => typeof id === "string" && idPattern.test(id) && !seen.has(id) && !!seen.add(id);
  const uniqueId = unique(new Set()), uniqueBlockId = unique(new Set());
  return input.every((item, position) => {
    if (!item || typeof item !== "object" || !uniqueId(item.id) || item.position !== position) return false;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 120) return false;
    if (item.phase !== undefined && (typeof item.phase !== "string" || !/^[a-z-]{1,40}$/.test(item.phase))) return false;
    if (item.purpose !== undefined && !purposeValues.has(item.purpose)) return false;
    if (item.grouping !== undefined && !groupingValues.has(item.grouping)) return false;
    if (item.outcomeIds !== undefined && !validOutcomeIds(item.outcomeIds)) return false;
    if (item.blocks !== undefined) {
      if (!Array.isArray(item.blocks) || !item.blocks.length || item.blocks.length > 12) return false;
      const blocks = item.blocks as Record<string, unknown>[];
      if (!blocks.some(block => block?.kind !== "teacher-note")) return false;
      return blocks.every(block => {
        if (!block || typeof block !== "object" || !uniqueBlockId(block.id) || !blockKindValues.has(String(block.kind))) return false;
        if (block.kind === "resource") return typeof block.resourceId === "string" && !!block.resourceId && (block.instructions === undefined || (typeof block.instructions === "string" && block.instructions.length <= 4000)) && (block.richContent === undefined || validRichText(block.richContent));
        if (block.kind === "question") return hasBody(block) && validQuestion(block.options, block.answer);
        return hasBody(block);
      });
    }
    if (!["text", "resource", "question"].includes(item.type) || typeof item.instructions !== "string" || item.instructions.length > 4000 || (!item.instructions.trim() && !validRichText(item.richContent)) || (item.richContent !== undefined && !validRichText(item.richContent))) return false;
    if (item.type === "resource" && (typeof item.resourceId !== "string" || !item.resourceId)) return false;
    if (item.type === "question" && !validQuestion(item.options, item.answer)) return false;
    return true;
  });
}
// Tables (ST-069): a table holds rows; a row holds header or data cells; a cell holds paragraphs or lists.
const tableParents: Record<string, string[]> = { tableRow: ["table"], tableHeader: ["tableRow"], tableCell: ["tableRow"] };
const richNodes = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "listItem", "blockquote", "table", "tableRow", "tableHeader", "tableCell"]);
const richMarks = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
/** Lesson blocks allow 12,000 characters; longer documents (contracts, DEC-046) pass larger limits. */
export function validRichText(value: unknown, limits: { text: number; nodes: number } = { text: 12000, nodes: 1200 }): boolean {
  if (!value || typeof value !== "object") return false;
  let textLength = 0, count = 0;
  function visit(item: unknown, depth: number, parent = "doc"): boolean {
    if (!item || typeof item !== "object" || depth > 10 || ++count > limits.nodes) return false;
    const n = item as Record<string, unknown>;
    if (typeof n.type !== "string" || !richNodes.has(n.type)) return false;
    if (tableParents[n.type] && !tableParents[n.type].includes(parent)) return false;
    if (n.type === "table" && parent !== "doc") return false;
    if (["table", "tableRow"].includes(n.type) && (!Array.isArray(n.content) || !n.content.length || n.content.length > 30)) return false;
    if (n.type === "text") { if (typeof n.text !== "string" || n.content !== undefined) return false; textLength += n.text.length; if (textLength > limits.text) return false; }
    if (n.type === "heading" && (!n.attrs || ![2, 3].includes(Number((n.attrs as Record<string, unknown>).level)))) return false;
    if (n.marks !== undefined && (!Array.isArray(n.marks) || n.marks.length > 6 || !n.marks.every(mark => {
      if (!mark || typeof mark !== "object" || !richMarks.has(String((mark as Record<string, unknown>).type))) return false;
      const m = mark as Record<string, unknown>;
      if (m.type !== "link") return true;
      const href = String((m.attrs as Record<string, unknown> | undefined)?.href || "");
      return /^https?:\/\/[^\s/?#@]+(?::\d+)?(?:[/?#]|$)/i.test(href);
    }))) return false;
    if (n.type === "table" && !(n.content as Record<string, unknown>[]).every(row => row?.type === "tableRow")) return false;
    if (n.type === "tableRow" && !(n.content as Record<string, unknown>[]).every(cell => ["tableHeader", "tableCell"].includes(String(cell?.type)))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(child => visit(child, depth + 1, n.type as string)));
  }
  const root = value as Record<string, unknown>;
  return root.type === "doc" && Array.isArray(root.content) && root.content.every(child => visit(child, 1)) && textLength > 0;
}
export { builtInRoles, coordinationPermissions, grantablePermissions, grantedIn, grantsInput, holds, inScope, isGrantable, permissionAreas, permissionCatalog, permissionKeys, permissionsOf, reachLabels, scopeInput, scopeLabel, securityGroupInput } from "./permissions";
export type { BuiltInRole, GroupGrant, PermissionDefinition, Reach } from "./permissions";
export { departureDate, departureReason, maxDepartureReason } from "./departures";
export { availabilityDays, availabilityInput, outsideAvailability, calendarDate, contactEmailInput, documentStatus, expiringWindowDays, maxAvailabilitySlots, maxEducationLength, maxSpecialties, maxSpecialtyLength, phoneInput, specialtiesInput, staffDocumentInput, staffDocumentLabel, staffDocumentTypes, staffProfileInput } from "./profiles";
export type { AvailabilitySlot, ProfileInput, StaffDocumentStatus, StaffDocumentType, Weekday } from "./profiles";
export { allNotificationTypes, channelLabels, defaultDeliverySettings, digestMessage, digestReason, emailFrequencies, emailFrequencyLabels, emailPlan, inQuietHours, isConfigurableType, isNotificationType, isSystemType, lockedBy, maxNotificationsPerRequest, nextDigestAt, notificationCatalog, notificationChannels, notificationDecision, notificationLabel, notificationMessage, notificationPreferencesInput, notificationReason, notificationReserve, notificationTypes, optionalNotificationCap, policyInput, preferencesInput, quietHoursEnd, receives, receivesOn, systemNotificationTypes } from "./notifications";
export type { ChannelPreferences, ConfigurableNotificationType, DeliverySettings, DigestDetails, DigestItem, EmailFrequency, EmailPlan, NotificationChannel, NotificationDefinition, NotificationDetails, NotificationFacts, NotificationPreferencesChange, NotificationStatus, NotificationType, SystemNotificationType } from "./notifications";
export { agendaKinds, agendaViews, canonicalLocale, defaultPreferences, densities, effectivePreferences, homePages, hourCycles, interfaceLanguages, localeHourCycle, localeWeekStart, maxTextScale, minTextScale, motions, orderedWeekdays, organizationLocaleInput, suggestedLocales, textScaleStep, themes, userPreferencesInput, wallClock, wallTimeIn } from "./preferences";
export type { AgendaKind, AgendaView, EffectivePreferences, HomePage, HourCycle, InterfaceLanguage, Theme, UserPreferences } from "./preferences";
export { csvCell, decimalHours, effectiveDuration, hoursAdjustmentInput, hoursCsv, hoursCsvHeader, hoursDay, hoursFilterInput, hoursStateLabels, hoursTotals, inHoursFilter, localDateTime, maxAdjustedMinutes, maxAdjustmentReason, minAdjustmentReason, reviewAfterMinutes } from "./hours";
export { declaredSteps, declareStep, missingSteps, nextStep, onboardingStatus, onboardingStatusLabels, onboardingStepLabels, onboardingSteps, onboardingStepStates, profileComplete, profileGaps } from "./onboarding";
export type { OnboardingFacts, ProfileFacts, StepRefusal } from "./onboarding";
export {
  areasFromSpecialties, audienceLabel, audienceView, countryCodes, countryName, credentialInput, credentialStatus, credentialStatusLabels, credentialTransition, credentialTypeLabel,
  credentialTypes, decisionNote, defaultVisibility, emptyProfessionalProfile, fieldLabel, formatLabel, httpsUrl, isCountry, iscedFields, iscedLevels, languageName, languageTag,
  learnerAudiences, levelLabel, linkKindLabel, modalityLabel, professionalProfileInput, proficiencyLabel, proficiencyLevels, profileChanges, profileCompleteness, profileLimits,
  profileLinkInput, profileLinkKinds, profileSections, profileStatusLabels, profileTransition, reaches, sameProfile, sectionLabel, storedProfile, storedVisibility, submissionGaps,
  teachingFormats, teachingModalities, validOrcid, videoUrlInput, visibilityInput, visibilityLabels,
} from "./professional";
export type { CredentialAction, CredentialInput, ProfileAction, ProfileActor, ProfileState } from "./professional";
export { accountMessage, accountNoticeReason, countryCode, deviceLabel, emailChangeHours, emailChangeInput, emailChangeLifetimeMs, emailChangeState, maskEmail, sessionTouchMs, signInHistoryLimit, signInRetentionDays } from "./account-settings";
export type { AccountNotice, AccountNoticeDetails, AccountNoticeKind, EmailChangeStatus } from "./account-settings";
export { closureLabels, closureOpen, closureReasonInput, closureStatuses, closureTransition, maxClosureReason, personalDataFile, personalDataFormat, personalDataSections } from "./closures";
export type { ClosureAction, ClosureStatus, PersonalDataSection } from "./closures";
export { closeReasonInput, compensationAllowed, compensationKinds, compensationLabels, compensationPeriods, compensationSummary, contractCanonical, contractDatesInput, contractEngagements, contractInForce, contractPhase, contractPhaseLabels, contractSignatureCanonical, contractSignedNameInput, contractStatusLabels, contractTemplateInput, contractTermFields, contractTermsFor, contractTermsInput, contractTextLimits, contractValues, contractVariables, contractVersionInput, engagementLabels, isEngagement, locationLabels, maxCloseReason, mergeContract, periodLabels, richPlainText, workLocations } from "./contracts";
export type { ContractVariable } from "./contracts";
export { academicYearEditable, academicYearInput, academicYearLabels, academicYearStatuses, academicYearTransition, activationBlocker, isPeriodKind, maxPeriods, nextAcademicYear, nextYearDay, maxGapDays, periodGaps, periodKindOf, periodKinds, periodName, scheduleSuggestion, splitPeriods } from "./academic-years";
export type { AcademicYearAction, AcademicYearDraft, PeriodDraft } from "./academic-years";
export { assessmentKindLabel, assessmentKinds, assessmentTemplates, averageOf, csvFile, defaultThresholds, gradeAverages, gradeResult, gradeScales, gradeStatistics, isAssessmentKind, isLetterThresholds, letterOf, maxAssessmentActivities, maxCommentLength, maxGradeChanges, passingChoices, pastedCells, periodFromPlan, planTotal, pointsInput, scoreInput, thresholdPresets, thresholdsText } from "./gradebook";
export type { GradingPolicy, PlannedActivity } from "./gradebook";
export { activitySummary, assessmentPeriodStatus, displayOf, learnerResult, markValue, pointsScheme, rubricInput, schemeExplanation, schemeFromSettings, schemeInput, schemeTemplates } from "./grading";
export { formGroups, groupRulesInput, groupToIndividual } from "./group-formation";
export type { FormedGroups, FormationLearner, GroupAdjustment, GroupRules, IndividualAssignment, PeerRating, UnmetConstraint } from "./group-formation";
export type { Activity as GradingActivity, AtomicMark, GradingPeriod, GradingScheme, LearnerResult, Mark, Rubric } from "./grading";
export { bibliographyRoleLabel, bibliographyRoles, isBibliographyRole, maxCitation, maxReferences, primaryBlocker, referenceInput } from "./bibliography";
export { competencyDescription, competencyName, curriculumPackages, indicatorEvidence, linkPlan, maxPickedIndicators, packageOf, packageProblems, packageSummary } from "./curriculum-packages";
export type { CurriculumPackage, PackageCompetency, PackageIndicator } from "./curriculum-packages";
export { draftFromOutput, fixtureGenerator, maxExcerpt, maxProposalItems, pagesLabel, pagesPerProposal, proposalBatch, proposalProblem, proposalPrompt, proposalPromptVersion, proposalSchema, proposalStatusLabels, relevantPages, sourceCitationVerified, sourceQuote, terms } from "./lesson-proposals";
export type { BookPage, LessonDraftGenerator, ProposalInput, ProposalOutput } from "./lesson-proposals";
export { pdfFile, pdfString, wrap } from "./pdf";
export type { PdfBlock, PdfDocument } from "./pdf";
export { fixtureMapper, mapCandidatePages, mapCandidates, mapPrompt, mapPromptVersion, mapSchema, mapSourceLabels, maxCandidateText, pagesInput, verifiedPages } from "./book-map";
export type { BookMapper, MapEvidence, MapInput, MapOutput, MapSource } from "./book-map";
export { classMinutesOf, lessonReview } from "./lesson-review";
export type { LessonReview, ReviewCheck, ReviewCheckId, ReviewContext, ReviewEvidence, ReviewLesson, ReviewStatus } from "./lesson-review";
export { aiPriceInput, aiTaskLabels, aiTasks, aiUsageSummary, priceOn, runCost } from "./ai-usage";
export type { AiPrice, AiRun, AiRunStatus, AiTask, AiTokenUsage, AiTotals, AiUsageSummary } from "./ai-usage";
export { applyChanges, checkedChanges, fixtureImprover, improveInput, improvePrompt, improvePromptVersion, improveSchema } from "./lesson-improve";
export type { ImproveChange, ImproveField, ImproveInput, ImproveOutput, LessonImprover, NewActivity } from "./lesson-improve";
export { fixtureWriter, writeActionLabels, writeFields, writeInput, writePrompt, writePromptVersion, writeSchema, writtenText } from "./ai-write";
export type { AiWriter, WriteAction, WriteField, WriteInput, WriteOutput } from "./ai-write";
export { defaultClassMinutes, proposeTimetable } from "./timetable-proposal";
export type { ProposalLesson, ProposalSession, TimetableAssignment, TimetableProposal } from "./timetable-proposal";
export { solveTimetable, weekdayNames } from "./timetable-solver";
export type { FixedMeeting, SolverBlock, SolverDay, SolverEducator, SolverInput, SolverMeeting, SolverResult, SolverRule, SolverSection, UnplacedSection } from "./timetable-solver";
export { fixtureRulesTranslator, ruleText, rulesPrompt, rulesPromptVersion, rulesSchema, solverRule } from "./timetable-rules";
export type { RuleContext, RulesInput, RulesOutput, RulesTranslator } from "./timetable-rules";

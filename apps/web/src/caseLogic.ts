export type Role = string;
export type Urgency = "Critical" | "High" | "Medium" | "Low";

export interface GeneratedTask {
    id: string;
    text: string;
    assignee: Role;
    assignedPerson?: string;
    reason?: string;
    urgency: Urgency;
    deadline: string | null;
    deadlineLabel?: string;       // human-readable e.g. "3 days before listing" or "Immediately"
    statutoryNote?: string;       // e.g. "SC Rules: 30 days from order date"
    isOverdue?: boolean;          // true if deadline has already passed
    daysUntilDeadline?: number;   // negative = overdue
    done: boolean;
    createdAt: string;
    isAuto: boolean;
    assignmentType?: 'ai' | 'backup' | 'standard';
    caseTypeDetected?: string;
    personFound?: boolean;
}

// ─── ROLE CONSTANTS ───────────────────────────────────────────────────────────
// Renamed as per Paari's review:
//   "Senior Advocate" → "Advocate"
//   "Junior Advocate" → "Associate Advocate"
//   "Paralegal / Clerk" stays the same
export const ROLES = {
    ADVOCATE: "Advocate",
    ASSOCIATE: "Associate Advocate",
    PARALEGAL: "Paralegal / Clerk",
} as const;

// ─── DEADLINE HELPERS ─────────────────────────────────────────────────────────

const today = (): string => new Date().toISOString().split("T")[0];

const daysFromToday = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
};

const beforeListing = (listingDate: string | null, daysBefore: number): string => {
    if (!listingDate) return daysFromToday(daysBefore === 0 ? 0 : daysBefore);
    const d = new Date(listingDate);
    d.setDate(d.getDate() - daysBefore);
    return d.toISOString().split("T")[0];
};

const probableNextListing = (listingDate: string | null, weeks: number): string => {
    const base = listingDate ? new Date(listingDate) : new Date();
    base.setDate(base.getDate() + weeks * 7);
    return base.toISOString().split("T")[0];
};

function annotateDeadline(task: GeneratedTask): GeneratedTask {
    if (!task.deadline) return task;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dl = new Date(task.deadline);
    dl.setHours(0, 0, 0, 0);
    const diff = Math.round((dl.getTime() - now.getTime()) / 86400000);
    return { ...task, daysUntilDeadline: diff, isOverdue: diff < 0 };
}

function makeTask(
    text: string,
    assignee: string,
    urgency: Urgency,
    deadline: string,
    deadlineLabel: string,
    statutoryNote?: string,
): GeneratedTask {
    return annotateDeadline({
        id: crypto.randomUUID(),
        text,
        assignee,
        urgency,
        deadline,
        deadlineLabel,
        statutoryNote,
        done: false,
        createdAt: new Date().toISOString(),
        isAuto: true,
    });
}

// ─── generateLegalTasks ───────────────────────────────────────────────────────
export function generateLegalTasks(
    caseType: string,
    _status: string,
    nextHearingDate: string | null,
    ourSide?: "Petitioner" | "Respondent" | null,
): { keyRisk: string; tasks: GeneratedTask[] } {

    // Disposed cases need no further action
    if (_status && _status.toLowerCase() === "disposed") {
        return { keyRisk: "Case is disposed. No further action required.", tasks: [] };
    }

    let keyRisk = "Standard case follow-up required.";
    const tasks: GeneratedTask[] = [];
    const t = caseType.toUpperCase();
    const listing = nextHearingDate;
    const isPetitioner = ourSide === "Petitioner";
    const isRespondent = ourSide === "Respondent";

    // Helper to tag tasks with party
    const tag = (task: GeneratedTask): GeneratedTask => ({ ...task, party: ourSide ?? undefined } as any);

    // ── SLP (Civil & Criminal) ────────────────────────────────────────────
    if (t.includes("SLP") || t.includes("SPECIAL LEAVE")) {
        const isCriminal = t.includes("CRL") || t.includes("CRIMINAL") || t.includes("CR.");

        if (isCriminal) {
            if (isRespondent) {
                keyRisk = "SLP (Criminal) — Respondent: Oppose bail/suspension and compile State/victim records.";
                tasks.push(tag(makeTask(
                    "File vakalatnama immediately after service of notice.",
                    ROLES.PARALEGAL, "Critical", today(), "Immediately",
                    "SC Rules: Respondent appearance required to oppose bail",
                )));
                tasks.push(tag(makeTask(
                    "Prepare reply opposing bail / suspension of sentence on merits.",
                    ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Compile State records: charge sheet, remand orders, police diary, and conviction order.",
                    ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Verify service of notice on all respondents and file affidavit of service.",
                    ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
                )));
            } else {
                keyRisk = "SLP (Criminal) — Petitioner: Surrender exemption and bail/suspension compliance are top priority.";
                tasks.push(tag(makeTask(
                    "Verify surrender exemption status and file proof of compliance if exemption granted.",
                    ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                    "SC Rules: Surrender compliance required before first listing",
                )));
                tasks.push(tag(makeTask(
                    "Draft and file application for bail / suspension of sentence.",
                    ROLES.ADVOCATE, "Critical", today(), "Immediately",
                )));
                tasks.push(tag(makeTask(
                    "Compile custody certificate, FIR copies, and lower court trial records.",
                    ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Settle grounds for Special Leave and bail/suspension arguments.",
                    ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Translate vernacular documents and prepare court bundles.",
                    ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
                )));
            }
        } else {
            if (isRespondent) {
                keyRisk = "SLP (Civil) — Respondent: File vakalatnama and oppose stay to prevent status quo from continuing.";
                tasks.push(tag(makeTask(
                    "File vakalatnama immediately upon service of notice.",
                    ROLES.PARALEGAL, "Critical", today(), "Immediately",
                    "SC Rules: Respondent must appear to oppose any stay application",
                )));
                tasks.push(tag(makeTask(
                    "Prepare counter affidavit opposing interim stay / status quo.",
                    ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Compile respondent's lower court records and compile judgments supporting HC order.",
                    ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Confirm service receipt and track if any co-respondents have filed vakalatnama.",
                    ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
                )));
            } else {
                keyRisk = "SLP (Civil) — Petitioner: Ensure filed within 90 days. File stay immediately to prevent execution.";
                tasks.push(tag(makeTask(
                    "Verify limitation period (90 days for SLP) and draft Condonation of Delay application if required.",
                    ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                    "Limitation Act + SC Rules: 90 days from date of impugned High Court order",
                )));
                tasks.push(tag(makeTask(
                    "File application for stay of impugned order to prevent execution.",
                    ROLES.ADVOCATE, "Critical", today(), "Immediately",
                )));
                tasks.push(tag(makeTask(
                    "Review lower court order and prepare list of dates / synopsis.",
                    ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Finalise grounds for Special Leave and settle with Advocate.",
                    ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
                )));
                tasks.push(tag(makeTask(
                    "Check defect list and file caveats if opposing party has not approached yet.",
                    ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
                )));
            }
        }

    // ── Review Petition ───────────────────────────────────────────────────
    } else if (t.includes("REVIEW") || t.includes("R.P.") || t.includes("RP(")) {
        if (isRespondent) {
            keyRisk = "Review Petition — Respondent: Prepare reply opposing review and monitor if stay pending review is sought.";
            tasks.push(tag(makeTask(
                "File vakalatnama and prepare reply opposing Review Petition on merits.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
                "SC Rules Order XLVII: Respondent entitled to oppose review",
            )));
            tasks.push(tag(makeTask(
                "Research precedents on review maintainability — verify if grounds fall within permissible scope.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Check if petitioner has sought stay pending review — file opposition if so.",
                ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
            tasks.push(tag(makeTask(
                "Obtain certified copy of the original judgment for reference.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        } else {
            keyRisk = "Review Petition — Petitioner: 30-day limitation from judgment. Cure defects immediately.";
            tasks.push(tag(makeTask(
                "Verify if Review Petition is within 30-day limitation period. File Condonation of Delay immediately if barred.",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                "SC Rules Order XLVII Rule 1: Review must be filed within 30 days of judgment",
            )));
            tasks.push(tag(makeTask(
                "Check office report for defects. If on default, cure all defects before Judge-in-Chambers listing.",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                "SC Rules: Default report listed before Judge-in-Chambers — same day action required",
            )));
            tasks.push(tag(makeTask(
                "Circulate Review Petition before Chamber Judge and ensure AOR certificate is in order.",
                ROLES.ADVOCATE, "Medium", beforeListing(listing, 7), "Before chamber listing",
            )));
            tasks.push(tag(makeTask(
                "Obtain certified copy of the judgment under review.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        }

    // ── Transfer Petition ─────────────────────────────────────────────────
    } else if (t.includes("TRANSFER") || t.includes("T.P.") || t.includes("TP(")) {
        if (isRespondent) {
            keyRisk = "Transfer Petition — Respondent: Oppose transfer with strong reasons for continuation in current court.";
            tasks.push(tag(makeTask(
                "File vakalatnama after service and prepare counter affidavit opposing transfer.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Compile documents justifying continuation in originating court (hardship, convenience, pending evidence).",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Check if Mediation Centre direction is issued — attend and file report.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        } else {
            keyRisk = "Transfer Petition — Petitioner: Ensure service on all respondents. Compile strong grounds for transfer.";
            tasks.push(tag(makeTask(
                "Confirm service status on all respondents and track India Post / dasti delivery.",
                ROLES.PARALEGAL, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Follow up on whether respondent has filed counter affidavit.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Check if Mediation Centre report is due and collect it after mediation date.",
                ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
            tasks.push(tag(makeTask(
                "Monitor respondent vakalatnama status — confirm appearance after service.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        }

    // ── Writ Petition ─────────────────────────────────────────────────────
    } else if (t.includes("WRIT") || t.includes("W.P.") || t.includes("WP(")) {
        if (isRespondent) {
            keyRisk = "Writ Petition — Respondent: File counter affidavit and oppose interim relief to avoid adverse ex-parte orders.";
            tasks.push(tag(makeTask(
                "File vakalatnama immediately and prepare counter affidavit on merits.",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                "Risk: Ex-parte interim orders if respondent does not appear",
            )));
            tasks.push(tag(makeTask(
                "File reply/objections to any interim relief application filed by petitioner.",
                ROLES.ADVOCATE, "Critical", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Compile government records / files to support counter and instructions from client department.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Verify if all co-respondents have filed vakalatnama — follow up on unrepresented respondents.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        } else {
            keyRisk = "Writ Petition — Petitioner: File interim relief application and ensure proper service on all respondents.";
            tasks.push(tag(makeTask(
                "Draft and file application for interim relief (stay / mandamus) with supporting affidavit.",
                ROLES.ADVOCATE, "Critical", today(), "Immediately",
            )));
            tasks.push(tag(makeTask(
                "Compile government notifications, orders, and statutory provisions relied upon.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Track service of notice on all respondents — file affidavit of service.",
                ROLES.PARALEGAL, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Prepare written submissions and compile supporting judgments.",
                ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        }

    // ── Contempt ──────────────────────────────────────────────────────────
    } else if (t.includes("CONTEMPT") || t.includes("CON(")) {
        if (isRespondent) {
            keyRisk = "Contempt — Contemnor (Respondent): Compliance affidavit or personal appearance is mandatory. Same-day action.";
            tasks.push(tag(makeTask(
                "Draft Reply to Show Cause Notice and prepare Compliance Affidavit with proof of compliance.",
                ROLES.ADVOCATE, "Critical", today(), "Immediately",
                "SC Rules: Contempt compliance required on same day of order",
            )));
            tasks.push(tag(makeTask(
                "Collate all compliance documents and prepare evidence of compliance (photographs, receipts, orders).",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            )));
            tasks.push(tag(makeTask(
                "Arrange personal appearance of contemnor in Court if directed or likely to be directed.",
                ROLES.ADVOCATE, "Critical", beforeListing(listing, 1), "Day before listing",
            )));
            tasks.push(tag(makeTask(
                "Prepare mitigation submissions in case partial non-compliance is admitted.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
        } else {
            keyRisk = "Contempt — Petitioner/Complainant: Compile evidence of willful disobedience and file promptly.";
            tasks.push(tag(makeTask(
                "Compile detailed affidavit setting out specific acts of non-compliance with the court order.",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            )));
            tasks.push(tag(makeTask(
                "File proof of service of the underlying order on the contemnors.",
                ROLES.PARALEGAL, "Critical", today(), "Immediately",
                "SC Rules: Service of order on contemnor is prerequisite for contempt",
            )));
            tasks.push(tag(makeTask(
                "Settle arguments on willful disobedience and prepare rejoinder to compliance affidavit.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
        }

    // ── Civil Appeal ──────────────────────────────────────────────────────
    } else if (t.includes("CIVIL APPEAL") || t.includes("C.A.") || t.includes("CA ")) {
        if (isRespondent) {
            keyRisk = "Civil Appeal — Respondent: Defend HC order and consider filing cross-objections if HC partially ruled against you.";
            tasks.push(tag(makeTask(
                "File vakalatnama after service and review HC judgment to identify grounds for cross-objections.",
                ROLES.ASSOCIATE, "High", today(), "Immediately",
            )));
            tasks.push(tag(makeTask(
                "Prepare counter affidavit / written submissions defending the HC order.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Verify adequacy of any deposit made by appellant — file objection if insufficient.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
                "SC Rules: Court-ordered deposit must be verified before hearing",
            )));
            tasks.push(tag(makeTask(
                "Compile paper book and prepare oral arguments for Advocate.",
                ROLES.ADVOCATE, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        } else {
            keyRisk = "Civil Appeal — Appellant (Petitioner): Comply with any deposit order — non-compliance is a Critical default.";
            tasks.push(tag(makeTask(
                "Check if any deposit order was made by HC. File proof of deposit immediately if pending.",
                ROLES.ASSOCIATE, "Critical", today(), "Immediately",
                "SC Rules: Court-ordered deposit must be filed before next listing",
            )));
            tasks.push(tag(makeTask(
                "Review HC decree and prepare list of dates / grounds of appeal.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Settle grounds of appeal and arguments for stay of HC decree.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Compile paper book and prepare written submissions.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
        }

    // ── Fallback ──────────────────────────────────────────────────────────
    } else {
        if (isRespondent) {
            keyRisk = "Respondent: File vakalatnama, track service, and prepare counter affidavit.";
            tasks.push(tag(makeTask(
                "File vakalatnama immediately after service of notice.",
                ROLES.PARALEGAL, "Critical", today(), "Immediately",
            )));
            tasks.push(tag(makeTask(
                "Prepare counter affidavit and reply to petitioner's claims.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Review pleadings and settle reply arguments with Advocate.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
        } else {
            keyRisk = "Ensure all pleadings are complete and office report shows no pending defects.";
            tasks.push(tag(makeTask(
                "Check office report for unserved respondents or filing defects.",
                ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
            )));
            tasks.push(tag(makeTask(
                "Prepare brief for upcoming hearing and compile relevant judgments.",
                ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
            tasks.push(tag(makeTask(
                "Review case strategy and lead arguments.",
                ROLES.ADVOCATE, "High", beforeListing(listing, 3), "3 days before listing",
            )));
        }
    }

    // ── Hearing approaching ───────────────────────────────────────────────
    if (listing) {
        const daysToHearing = Math.round(
            (new Date(listing).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
        );
        const label = daysToHearing <= 0 ? "TODAY — case is listed"
            : daysToHearing === 1 ? "TOMORROW"
            : `${daysToHearing} days away`;
        keyRisk = `HEARING ${label} (${listing}). ` + keyRisk;
        tasks.push(tag(makeTask(
            `Final review: case listed on ${listing}. Ensure Advocate is briefed and all files are in order.`,
            ROLES.ADVOCATE, "Critical", listing, `By hearing date — ${listing}`,
        )));
    }

    return { keyRisk, tasks };
}

// ─── generateOfficeReportTasks ────────────────────────────────────────────────
export function generateOfficeReportTasks(
    reportText: string | null,
    listingDate?: string | null,
    ourSide?: "Petitioner" | "Respondent" | null,
    hasActiveStay?: boolean,
): GeneratedTask[] {
    if (!reportText) return [];

    const tasks: GeneratedTask[] = [];
    const txt = reportText.toLowerCase();
    const listing = listingDate ?? null;

    const has = (...phrases: string[]) => phrases.some(p => txt.includes(p));

    // ── CRITICAL ──────────────────────────────────────────────────────────

    if (has("not cured the defects", "defects not cured", "office report on default", "on default")) {
        tasks.push(makeTask(
            "Cure all defects in petition immediately — list each defect clearly and file before Judge-in-Chambers listing.",
            ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            "SC Rules: Default report goes before Judge-in-Chambers — same day cure required",
        ));
    }

    if (has("revised office report on default", "second default", "still defective")) {
        tasks.push(makeTask(
            "Re-file curing all defects — this is a second default, escalate to Advocate immediately.",
            ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            "SC Rules: Second default — risk of dismissal",
        ));
    }

    if (has("proof of deposit not filed", "deposit not filed", "deposit order")) {
        tasks.push(makeTask(
            "File proof of deposit with registry — court-ordered deposit compliance is mandatory.",
            ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            "SC Rules: Deposit must be filed within timeline specified in court order",
        ));
    }

    if (has("neither taken fresh steps", "not taken fresh steps", "fresh steps not taken")) {
        tasks.push(makeTask(
            "URGENT: Take fresh steps for service immediately — this is a court compliance failure.",
            ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            "SC Rules: Fresh steps for service must be taken within time directed by court",
        ));
    }

    if (has("barred by time", "time barred", "limitation expired")) {
        tasks.push(makeTask(
            "File Condonation of Delay application immediately — matter is barred by limitation.",
            ROLES.ASSOCIATE, "Critical", today(), "Immediately",
            "Limitation Act: Condonation application must accompany main petition",
        ));
    }

    if (has("contempt", "compliance order", "show cause")) {
        tasks.push(makeTask(
            "Draft compliance affidavit / reply to show cause notice — personal appearance may be required.",
            ROLES.ADVOCATE, "Critical", today(), "Immediately",
            "SC Rules: Contempt compliance required on same day",
        ));
    }

    // ── HIGH — 3 days before listing ─────────────────────────────────────

    // Counter affidavit — side aware
    if (has("counter affidavit not filed", "counter affidavit has not been filed", "counter not filed")) {
        const isPetitioner = ourSide === "Petitioner";
        const stayActive = hasActiveStay === true;
        const urgency: Urgency = isPetitioner && !stayActive ? "Low" : "High";
        const deadlineStr = urgency === "High" ? beforeListing(listing, 3) : beforeListing(listing, 14);
        const deadlineLabel = urgency === "High" ? "3 days before listing" : "2 weeks before listing";
        const sideNote = isPetitioner && !stayActive
            ? "We represent the Petitioner — LOW priority unless a stay is operating against us"
            : "Follow up with respondent / opposite counsel on counter affidavit";
        tasks.push(makeTask(
            `Follow up — Counter Affidavit not filed by respondent. ${sideNote}.`,
            ROLES.ASSOCIATE, urgency, deadlineStr, deadlineLabel,
        ));
    }

    if (has("service not complete", "service incomplete", "service is not complete")) {
        tasks.push(makeTask(
            "Follow up on incomplete service — identify which respondents are unserved and take appropriate steps.",
            ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
        ));
    }

    if (has("unserved cover received", "cover received unserved", "returned unserved", "notice returned")) {
        tasks.push(makeTask(
            "Notice returned unserved — address issue and take fresh steps for service (dasti / substituted service).",
            ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            "SC Rules: Fresh steps must be taken within time directed after unserved cover received",
        ));
    }

    if (has("interaction is pending", "interaction pending", "ia interaction")) {
        tasks.push(makeTask(
            "IA pending registry interaction — prepare documents and attend registry for interaction.",
            ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
        ));
    }

    if (has("cause title amended", "cause title amendment", "amended cause title")) {
        tasks.push(makeTask(
            "Verify amended cause title is correctly reflected in all filings and circulated copies.",
            ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
        ));
    }

    if (has("surrender exemption granted", "surrender exemption")) {
        tasks.push(makeTask(
            "File proof of compliance with surrender exemption conditions before first listing date.",
            ROLES.PARALEGAL, "High", beforeListing(listing, 3), "Before first listing date",
            "SC Rules: Surrender exemption compliance required before listing",
        ));
    }

    if (has("sealed cover", "mercy petition")) {
        tasks.push(makeTask(
            "Confirm sealed cover protocol is followed — Advocate must be informed before hearing.",
            ROLES.ADVOCATE, "High", beforeListing(listing, 3), "Before hearing",
        ));
    }

    if (has("prison visit report", "prison report")) {
        tasks.push(makeTask(
            "Forward prison visit report to Advocate via email — same day.",
            ROLES.PARALEGAL, "High", today(), "Same day",
        ));
    }

    if (has("statement of case not filed", "synopsis not filed", "statement of case")) {
        tasks.push(makeTask(
            "Draft and file Statement of Case / Synopsis as directed.",
            ROLES.ASSOCIATE, "High", beforeListing(listing, 3), "3 days before listing",
            "SC Rules: Statement of case required before hearing",
        ));
    }

    // ── MEDIUM — 1 week before listing ───────────────────────────────────

    if (has("no one has entered appearance", "none has entered appearance", "no appearance entered", "not entered appearance")) {
        tasks.push(makeTask(
            "Monitor respondent appearance — respondent served but has not filed vakalatnama.",
            ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("rejoinder to be filed", "rejoinder affidavit", "file rejoinder")) {
        tasks.push(makeTask(
            "Prepare Rejoinder Affidavit — review counter affidavit filed by respondent and draft response.",
            ROLES.ADVOCATE, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("dasti service permitted", "dasti service allowed", "permission for dasti")) {
        tasks.push(makeTask(
            "Effect dasti service on respondent and file affidavit of dasti service with registry.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
            "SC Rules: Affidavit of dasti service must be filed within time permitted by court",
        ));
    }

    if (has("affidavit of dasti service", "dasti service affidavit")) {
        tasks.push(makeTask(
            "File Affidavit of Dasti Service with registry — confirm exact deadline with court order.",
            ROLES.ASSOCIATE, "Medium",
            listing ?? daysFromToday(7),
            "As per court order permitting dasti service",
            "SC Rules: Dasti service affidavit deadline set by court in order permitting dasti",
        ));
    }

    if (has("granted time to file", "time to file", "given time")) {
        tasks.push(makeTask(
            "Monitor — time granted to file document. Track if filed within the granted deadline.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("list after two weeks", "list after 2 weeks")) {
        const probableDate = probableNextListing(listing, 2);
        tasks.push(makeTask(
            `Matter adjourned — probable next listing date: ${probableDate}. Prepare for hearing.`,
            ROLES.ASSOCIATE, "Medium", probableDate, `Probable next listing: ${probableDate}`,
        ));
    } else if (has("list after four weeks", "list after 4 weeks")) {
        const probableDate = probableNextListing(listing, 4);
        tasks.push(makeTask(
            `Matter adjourned — probable next listing date: ${probableDate}. Prepare for hearing.`,
            ROLES.ASSOCIATE, "Medium", probableDate, `Probable next listing: ${probableDate}`,
        ));
    } else if (has("adjourned", "matter adjourned")) {
        const probableDate = probableNextListing(listing, 3);
        tasks.push(makeTask(
            `Matter adjourned — probable next listing date: ${probableDate}. Update diary and prepare.`,
            ROLES.ASSOCIATE, "Medium", probableDate, `Probable next listing: ${probableDate}`,
        ));
    }

    if (has("by way of last chance", "last chance", "as a last chance")) {
        tasks.push(makeTask(
            "IMPORTANT: Last chance given by court — file required document without fail before next listing.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing — last chance order",
            "Court has given last chance — non-compliance may result in dismissal",
        ));
    }

    if (has("tagged with", "tagged along", "connected with")) {
        tasks.push(makeTask(
            "Matter tagged with connected case — monitor main matter listing for next hearing.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("process the matter for listing", "process for listing", "matter for listing")) {
        tasks.push(makeTask(
            "Check listing schedule with registry and confirm next hearing date.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("application filed by respondent", "ia filed by respondent", "opposite party filed")) {
        tasks.push(makeTask(
            "Respondent has filed an Interlocutory Application — prepare reply / objection.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "1 week before listing",
        ));
    }

    if (has("slr", "referred to cji", "bench constitution", "constitution of bench")) {
        tasks.push(makeTask(
            "Track bench constitution — matter referred to CJI. Check monthly.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "Check monthly",
        ));
    }

    if (has("icmis", "digital records uploaded")) {
        tasks.push(makeTask(
            "Confirm digital records are accessible on ICMIS before listing date.",
            ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "Confirm before listing",
        ));
    }

    if (has("application to withdraw", "withdraw the petition", "withdrawal application")) {
        tasks.push(makeTask(
            "Process withdrawal application — Advocate to confirm instructions before filing.",
            ROLES.ADVOCATE, "Medium", beforeListing(listing, 7), "Before listing",
        ));
    }

    if (has("counsel discharged", "notice of alternate arrangement", "noa")) {
        tasks.push(makeTask(
            "Track delivery of Notice of Alternate Arrangement (NOA) via India Post.",
            ROLES.PARALEGAL, "Medium", beforeListing(listing, 7), "Check India Post tracking",
        ));
    }

    if (has("mediation centre", "mediation report", "sc mediation")) {
        tasks.push(makeTask(
            "Collect Mediation Centre report after mediation date and file with registry.",
            ROLES.ASSOCIATE, "Medium", beforeListing(listing, 7), "After mediation date",
        ));
    }

    // ── LOW — Monitor only ────────────────────────────────────────────────

    if (has("vakalatnama not filed", "vakalatnama has not been filed")) {
        tasks.push(makeTask(
            "Note: Respondent vakalatnama not filed despite service — monitor.",
            ROLES.PARALEGAL, "Low", beforeListing(listing, 14), "2 weeks before listing",
        ));
    }

    if (has("interim stay granted", "stay granted", "stay of operation")) {
        tasks.push(makeTask(
            "Interim stay granted — note in file. Obtain certified copy of stay order when available.",
            ROLES.PARALEGAL, "Low", beforeListing(listing, 14), "2 weeks before listing",
        ));
    }

    if (has("call for records", "records called for", "records called from")) {
        tasks.push(makeTask(
            "Records called from court below — monitor receipt and update file when received.",
            ROLES.PARALEGAL, "Low", beforeListing(listing, 14), "2 weeks before listing",
        ));
    }

    if (has("service is complete", "service complete", "service has been completed")) {
        tasks.push(makeTask(
            "Service complete on all respondents — note in file, no further action required.",
            ROLES.PARALEGAL, "Low", beforeListing(listing, 14), "Record update only",
        ));
    }

    if (has("matter is ready for listing", "ready for listing")) {
        tasks.push(makeTask(
            "Matter is ready for listing — monitor schedule and prepare for hearing.",
            ROLES.ASSOCIATE, "Low", beforeListing(listing, 14), "2 weeks before listing",
        ));
    }

    if (has("copy circulated herewith", "copy circulated", "certified copy circulated")) {
        tasks.push(makeTask(
            "Confirm receipt of circulated copy — update file records.",
            ROLES.PARALEGAL, "Low", beforeListing(listing, 14), "Record update only",
        ));
    }

    if (has("disposed of", "matter disposed")) {
        tasks.push(makeTask(
            "Update case status to Disposed — obtain certified copy of final order.",
            ROLES.PARALEGAL, "Low", today(), "Record update — same day",
        ));
    }

    if (has("dismissed as withdrawn", "withdrawn")) {
        tasks.push(makeTask(
            "Update case status to Withdrawn — file withdrawal order in records.",
            ROLES.PARALEGAL, "Low", today(), "Record update — same day",
        ));
    }

    return tasks;
}
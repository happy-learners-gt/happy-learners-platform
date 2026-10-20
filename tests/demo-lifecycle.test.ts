import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { contractCanonical, contractPhase, contractSignatureCanonical } from "../packages/domain/src/index";

/** DEC-046: the demo lifecycle seed writes fingerprints with the same canonical JSON the API uses. */
function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("database/migrations").filter(file => file.endsWith(".sql")).sort()) db.exec(readFileSync(join("database/migrations", name), "utf8"));
  return db;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("DEC-046 demo educator lifecycle", () => {
  it("siembra perfiles, credenciales, plantillas, contratos en cada fase y huellas que coinciden con el dominio", () => {
    const db = migrated();
    expect(db.prepare("SELECT contract_required FROM organizations WHERE id='org-demo'").get()).toEqual({ contract_required: 1 });
    const names = db.prepare("SELECT name FROM contract_templates WHERE organization_id='org-demo' AND id LIKE 'ct-%' ORDER BY name").all() as { name: string }[];
    expect(names.map(item => item.name)).toEqual(expect.arrayContaining([
      "Prestación de servicios por clase impartida", "Relación laboral docente", "Voluntariado docente ad honorem",
    ]));
    const profiles = db.prepare("SELECT u.username,p.status FROM staff_profiles p JOIN users u ON u.id=p.user_id WHERE p.organization_id='org-demo' AND u.username IN ('ana.lopez','carlos.mejia','diego.ramirez','lucia.herrera','sofia.castillo','tomas.aguilar','educador-demo') ORDER BY u.username").all() as { username: string; status: string }[];
    expect(profiles).toEqual([
      { username: "ana.lopez", status: "published" },
      { username: "carlos.mejia", status: "in_review" },
      { username: "diego.ramirez", status: "changes_requested" },
      { username: "educador-demo", status: "published" },
      { username: "lucia.herrera", status: "published" },
      { username: "sofia.castillo", status: "published" },
      { username: "tomas.aguilar", status: "published" },
    ]);
    const credentials = db.prepare("SELECT status,rejection_reason AS reason,expires_on AS expires FROM staff_credentials WHERE organization_id='org-demo' ORDER BY id").all() as { status: string; reason: string | null; expires: string | null }[];
    expect(credentials.some(item => item.status === "verified" && !item.expires)).toBe(true);
    expect(credentials.some(item => item.status === "submitted")).toBe(true);
    expect(credentials.some(item => item.status === "rejected" && item.reason)).toBe(true);
    expect(credentials.some(item => item.status === "verified" && item.expires && item.expires < "2026-10-20")).toBe(true);
    expect(db.prepare("SELECT theme,hour_cycle AS hours FROM user_preferences WHERE user_id='seed-user-sofia'").get()).toEqual({ theme: "dark", hours: "h12" });
    expect(db.prepare("SELECT text_scale AS scale FROM user_preferences WHERE user_id='seed-user-lucia'").get()).toEqual({ scale: 125 });
    expect((db.prepare("SELECT count(*) AS n FROM notification_inbox WHERE organization_id='org-demo'").get() as { n: number }).n).toBeGreaterThanOrEqual(3);
    expect((db.prepare("SELECT count(*) AS n FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id WHERE d.id IN ('legal-demo-terms-1','legal-demo-privacy-1') AND a.withdrawn_at IS NULL").get() as { n: number }).n).toBeGreaterThanOrEqual(2);
    expect(db.prepare("SELECT status FROM invitations WHERE id='inv-lifecycle-paula'").get()).toEqual({ status: "pending" });
    expect(db.prepare("SELECT status FROM account_closures WHERE id='closure-sofia-demo'").get()).toEqual({ status: "requested" });
    expect(db.prepare("SELECT count(*) AS n FROM staff_documents WHERE organization_id='org-demo' AND id LIKE 'lifecycle-%'").get()).toEqual({ n: 0 });

    const rows = db.prepare("SELECT * FROM contracts WHERE id LIKE 'contract-%'").all() as Record<string, string | null>[];
    const today = "2026-10-20";
    const phases = new Set(rows.map(row => contractPhase({
      status: row.status as never, startDate: row.start_date as string, endDate: row.end_date, terminationDate: row.termination_date,
    }, today)));
    for (const phase of ["in-force", "scheduled", "awaiting-signature", "expired", "terminated", "superseded", "declined"]) expect(phases.has(phase as never), phase).toBe(true);
    expect(rows.some(row => row.user_id === "seed-user-tomas" && row.status === "sent")).toBe(true);

    const admin = db.prepare("SELECT username FROM users WHERE id=?").get("user-0") as { username: string };
    for (const row of rows) {
      const document = sha(contractCanonical({
        id: row.id as string, organizationId: row.organization_id as string, templateVersionId: row.template_version_id as string,
        engagement: row.engagement as never, title: row.title as string, bodyText: row.body_text as string,
        terms: JSON.parse(row.terms_json as string), partyName: row.party_name as string, partyEmail: row.party_email,
        startDate: row.start_date as string, endDate: row.end_date,
      }));
      expect(row.document_sha256, row.id as string).toBe(document);
      expect(row.org_signature_sha256, `${row.id} org`).toBe(sha(contractSignatureCanonical({
        contractId: row.id as string, organizationId: row.organization_id as string, party: "organization",
        userId: row.org_signer_id as string, username: admin.username, signedName: row.org_signed_name as string,
        documentSha256: document, signedAt: row.org_signed_at as string,
      })));
      if (row.member_signed_at) {
        const member = db.prepare("SELECT username FROM users WHERE id=?").get(row.user_id) as { username: string };
        expect(row.member_signature_sha256, `${row.id} member`).toBe(sha(contractSignatureCanonical({
          contractId: row.id as string, organizationId: row.organization_id as string, party: "member",
          userId: row.user_id as string, username: member.username, signedName: row.member_signed_name as string,
          documentSha256: document, signedAt: row.member_signed_at,
        })));
      }
    }
  });
});

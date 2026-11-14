import { randomInt, randomUUID } from "node:crypto";
import type {
  ConfirmVerificationResult,
  IdentityDetails,
  IdentityProvider,
  StartVerificationResult,
} from "./IdentityProvider.js";

// A record in the fake register. The NIUs follow the card format (1234-234-2344)
// and all start with 0000, so none can be a real person's. D132: first name and
// surname kept apart, like on the card.
type AnidRecord = { niu: string; firstName: string; lastName: string; dateOfBirth: string; phone: string };

type PendingVerification = { code: string; expiresAt: number; attemptsLeft: number; fullName: string };

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 3;

// Demo identity register: 100 invented people for the pilot's testers
// (docs/test-identities.md). 1 January is a common recorded date when a
// person's exact date of birth is unknown.
const DEMO_REGISTER: AnidRecord[] = [
  { niu: "0000-000-0001", firstName: "Akossiwa", lastName: "Mensah", dateOfBirth: "1984-03-12", phone: "+22890000001" },
  { niu: "0000-000-0002", firstName: "Abla", lastName: "Agbeko", dateOfBirth: "1990-07-25", phone: "+22890000002" },
  { niu: "0000-000-0003", firstName: "Koffi", lastName: "Amegah", dateOfBirth: "1979-01-01", phone: "+22890000003" },
  { niu: "0000-000-0004", firstName: "Marie", lastName: "Koffi", dateOfBirth: "1988-05-04", phone: "+22890000004" },
  { niu: "0000-000-0005", firstName: "Grace", lastName: "Mensah", dateOfBirth: "1992-11-19", phone: "+22890000005" },
  { niu: "0000-000-0006", firstName: "Ama", lastName: "Dossou", dateOfBirth: "1986-02-27", phone: "+22890000006" },
  { niu: "0000-000-0007", firstName: "Sarah", lastName: "Agbo", dateOfBirth: "1995-09-08", phone: "+22890000007" },
  { niu: "0000-000-0008", firstName: "Afi", lastName: "Lawson", dateOfBirth: "1991-06-30", phone: "+22890000008" },
  { niu: "0000-000-0009", firstName: "Ruth", lastName: "Akue", dateOfBirth: "1983-12-15", phone: "+22890000009" },
  { niu: "0000-000-0010", firstName: "Esther", lastName: "Kodjo", dateOfBirth: "1997-04-21", phone: "+22890000010" },
  { niu: "0000-000-0011", firstName: "Rose", lastName: "Sossou", dateOfBirth: "1989-08-03", phone: "+22890000011" },
  { niu: "0000-000-0012", firstName: "Julie", lastName: "Ayivi", dateOfBirth: "1985-01-01", phone: "+22890000012" },
  { niu: "0000-000-0013", firstName: "Claire", lastName: "Soglo", dateOfBirth: "1993-03-17", phone: "+22890000013" },
  { niu: "0000-000-0014", firstName: "Anne", lastName: "Tossou", dateOfBirth: "1990-10-09", phone: "+22890000014" },
  { niu: "0000-000-0015", firstName: "Linda", lastName: "Adjo", dateOfBirth: "1982-07-14", phone: "+22890000015" },
  { niu: "0000-000-0016", firstName: "Essi", lastName: "Kossi", dateOfBirth: "1994-02-02", phone: "+22890000016" },
  { niu: "0000-000-0017", firstName: "Yawa", lastName: "Amouzou", dateOfBirth: "1987-11-28", phone: "+22890000017" },
  { niu: "0000-000-0018", firstName: "Dela", lastName: "Attisso", dateOfBirth: "1996-05-23", phone: "+22890000018" },
  { niu: "0000-000-0019", firstName: "Kafui", lastName: "Kpodar", dateOfBirth: "1981-09-12", phone: "+22890000019" },
  { niu: "0000-000-0020", firstName: "Sena", lastName: "Dogbe", dateOfBirth: "1998-12-06", phone: "+22890000020" },
  { niu: "0000-000-0021", firstName: "Edem", lastName: "Lassey", dateOfBirth: "1986-08-19", phone: "+22890000021" },
  { niu: "0000-000-0022", firstName: "Mariam", lastName: "Akakpo", dateOfBirth: "1980-05-23", phone: "+22890000022" },
  { niu: "0000-000-0023", firstName: "Fatou", lastName: "Messan", dateOfBirth: "1997-10-07", phone: "+22890000023" },
  { niu: "0000-000-0024", firstName: "Aïcha", lastName: "Gbadoe", dateOfBirth: "1999-08-27", phone: "+22890000024" },
  { niu: "0000-000-0025", firstName: "Joy", lastName: "Tchalla", dateOfBirth: "1988-10-14", phone: "+22890000025" },
  { niu: "0000-000-0026", firstName: "Mercy", lastName: "Djossou", dateOfBirth: "1989-06-03", phone: "+22890000026" },
  { niu: "0000-000-0027", firstName: "Lucie", lastName: "Afanou", dateOfBirth: "1991-06-12", phone: "+22890000027" },
  { niu: "0000-000-0028", firstName: "Nadia", lastName: "Kudzo", dateOfBirth: "1978-10-13", phone: "+22890000028" },
  { niu: "0000-000-0029", firstName: "Prisca", lastName: "Pali", dateOfBirth: "1991-02-09", phone: "+22890000029" },
  { niu: "0000-000-0030", firstName: "Sandra", lastName: "Ahianyo", dateOfBirth: "1990-03-10", phone: "+22890000030" },
  { niu: "0000-000-0031", firstName: "Victoire", lastName: "Edoh", dateOfBirth: "1992-02-28", phone: "+22890000031" },
  { niu: "0000-000-0032", firstName: "Josiane", lastName: "Apedo", dateOfBirth: "1989-03-25", phone: "+22890000032" },
  { niu: "0000-000-0033", firstName: "Brigitte", lastName: "Amenyo", dateOfBirth: "1984-08-23", phone: "+22890000033" },
  { niu: "0000-000-0034", firstName: "Eunice", lastName: "Kangni", dateOfBirth: "1986-01-15", phone: "+22890000034" },
  { niu: "0000-000-0035", firstName: "Gloria", lastName: "Bassah", dateOfBirth: "2002-01-11", phone: "+22890000035" },
  { niu: "0000-000-0036", firstName: "Hélène", lastName: "Quashie", dateOfBirth: "1985-08-10", phone: "+22890000036" },
  { niu: "0000-000-0037", firstName: "Irène", lastName: "Tetevi", dateOfBirth: "1991-10-14", phone: "+22890000037" },
  { niu: "0000-000-0038", firstName: "Jeanne", lastName: "Klutse", dateOfBirth: "1985-04-10", phone: "+22890000038" },
  { niu: "0000-000-0039", firstName: "Laure", lastName: "Zinsou", dateOfBirth: "2001-10-23", phone: "+22890000039" },
  { niu: "0000-000-0040", firstName: "Monique", lastName: "Abalo", dateOfBirth: "2004-03-16", phone: "+22890000040" },
  { niu: "0000-000-0041", firstName: "Odile", lastName: "Dogo", dateOfBirth: "1973-08-10", phone: "+22890000041" },
  { niu: "0000-000-0042", firstName: "Pauline", lastName: "Takpara", dateOfBirth: "1996-02-16", phone: "+22890000042" },
  { niu: "0000-000-0043", firstName: "Sylvie", lastName: "Agbodjan", dateOfBirth: "1993-10-24", phone: "+22890000043" },
  { niu: "0000-000-0044", firstName: "Thérèse", lastName: "Hounkpati", dateOfBirth: "1997-01-01", phone: "+22890000044" },
  { niu: "0000-000-0045", firstName: "Agnès", lastName: "Segbedzi", dateOfBirth: "1985-02-19", phone: "+22890000045" },
  { niu: "0000-000-0046", firstName: "Béatrice", lastName: "Gbedemah", dateOfBirth: "1987-01-03", phone: "+22890000046" },
  { niu: "0000-000-0047", firstName: "Céline", lastName: "Bataka", dateOfBirth: "1996-10-12", phone: "+22890000047" },
  { niu: "0000-000-0048", firstName: "Diane", lastName: "Fiagbe", dateOfBirth: "1978-10-27", phone: "+22890000048" },
  { niu: "0000-000-0049", firstName: "Elise", lastName: "Adanlete", dateOfBirth: "2001-01-18", phone: "+22890000049" },
  { niu: "0000-000-0050", firstName: "Flora", lastName: "Alognon", dateOfBirth: "1992-05-23", phone: "+22890000050" },
  { niu: "0000-000-0051", firstName: "Gisèle", lastName: "Kpeli", dateOfBirth: "1994-02-15", phone: "+22890000051" },
  { niu: "0000-000-0052", firstName: "Honorine", lastName: "Atayi", dateOfBirth: "1972-03-14", phone: "+22890000052" },
  { niu: "0000-000-0053", firstName: "Inès", lastName: "Sedzro", dateOfBirth: "1985-12-08", phone: "+22890000053" },
  { niu: "0000-000-0054", firstName: "Judith", lastName: "Karewa", dateOfBirth: "1992-12-24", phone: "+22890000054" },
  { niu: "0000-000-0055", firstName: "Kadi", lastName: "Fiadjoe", dateOfBirth: "1976-08-28", phone: "+22890000055" },
  { niu: "0000-000-0056", firstName: "Léa", lastName: "Kokou", dateOfBirth: "1993-09-13", phone: "+22890000056" },
  { niu: "0000-000-0057", firstName: "Mawuena", lastName: "Aziaka", dateOfBirth: "1995-07-02", phone: "+22890000057" },
  { niu: "0000-000-0058", firstName: "Nina", lastName: "Banla", dateOfBirth: "1988-06-19", phone: "+22890000058" },
  { niu: "0000-000-0059", firstName: "Olga", lastName: "Dzidzo", dateOfBirth: "1996-10-20", phone: "+22890000059" },
  { niu: "0000-000-0060", firstName: "Pélagie", lastName: "Eklu", dateOfBirth: "1995-02-26", phone: "+22890000060" },
  { niu: "0000-000-0061", firstName: "Rachel", lastName: "Folly", dateOfBirth: "1999-05-12", phone: "+22890000061" },
  { niu: "0000-000-0062", firstName: "Salomé", lastName: "Gaba", dateOfBirth: "1991-04-15", phone: "+22890000062" },
  { niu: "0000-000-0063", firstName: "Tina", lastName: "Hunlede", dateOfBirth: "1975-03-06", phone: "+22890000063" },
  { niu: "0000-000-0064", firstName: "Ursule", lastName: "Johnson", dateOfBirth: "2003-05-17", phone: "+22890000064" },
  { niu: "0000-000-0065", firstName: "Valérie", lastName: "Kuevi", dateOfBirth: "1979-09-13", phone: "+22890000065" },
  { niu: "0000-000-0066", firstName: "Yvonne", lastName: "Lanyo", dateOfBirth: "1992-08-14", phone: "+22890000066" },
  { niu: "0000-000-0067", firstName: "Zoé", lastName: "Mawussi", dateOfBirth: "1980-04-11", phone: "+22890000067" },
  { niu: "0000-000-0068", firstName: "Adjoa", lastName: "Nyaku", dateOfBirth: "2003-10-21", phone: "+22890000068" },
  { niu: "0000-000-0069", firstName: "Akua", lastName: "Amedome", dateOfBirth: "1979-06-16", phone: "+22890000069" },
  { niu: "0000-000-0070", firstName: "Amina", lastName: "Perez", dateOfBirth: "1976-12-11", phone: "+22890000070" },
  { niu: "0000-000-0071", firstName: "Awa", lastName: "Rodrigue", dateOfBirth: "2002-06-11", phone: "+22890000071" },
  { niu: "0000-000-0072", firstName: "Bintou", lastName: "Santos", dateOfBirth: "1998-09-23", phone: "+22890000072" },
  { niu: "0000-000-0073", firstName: "Christine", lastName: "Teko", dateOfBirth: "1993-03-22", phone: "+22890000073" },
  { niu: "0000-000-0074", firstName: "Dorcas", lastName: "Vovor", dateOfBirth: "1987-10-06", phone: "+22890000074" },
  { niu: "0000-000-0075", firstName: "Emma", lastName: "Wilson", dateOfBirth: "1989-08-16", phone: "+22890000075" },
  { niu: "0000-000-0076", firstName: "Félicité", lastName: "Yovo", dateOfBirth: "2004-04-10", phone: "+22890000076" },
  { niu: "0000-000-0077", firstName: "Georgette", lastName: "Zogbe", dateOfBirth: "1997-07-24", phone: "+22890000077" },
  { niu: "0000-000-0078", firstName: "Hawa", lastName: "Aholou", dateOfBirth: "1983-01-16", phone: "+22890000078" },
  { niu: "0000-000-0079", firstName: "Isabelle", lastName: "Badji", dateOfBirth: "1995-03-02", phone: "+22890000079" },
  { niu: "0000-000-0080", firstName: "Joëlle", lastName: "Coulibaly", dateOfBirth: "2001-05-16", phone: "+22890000080" },
  { niu: "0000-000-0081", firstName: "Kossiwa", lastName: "Diallo", dateOfBirth: "2003-03-28", phone: "+22890000081" },
  { niu: "0000-000-0082", firstName: "Lydia", lastName: "Ekoue", dateOfBirth: "1995-03-22", phone: "+22890000082" },
  { niu: "0000-000-0083", firstName: "Martine", lastName: "Fofana", dateOfBirth: "1974-09-04", phone: "+22890000083" },
  { niu: "0000-000-0084", firstName: "Noëlle", lastName: "Garba", dateOfBirth: "1977-08-06", phone: "+22890000084" },
  { niu: "0000-000-0085", firstName: "Océane", lastName: "Hounsou", dateOfBirth: "1975-07-06", phone: "+22890000085" },
  { niu: "0000-000-0086", firstName: "Patience", lastName: "Ismael", dateOfBirth: "1997-03-23", phone: "+22890000086" },
  { niu: "0000-000-0087", firstName: "Rebecca", lastName: "Jacob", dateOfBirth: "1993-05-18", phone: "+22890000087" },
  { niu: "0000-000-0088", firstName: "Sabine", lastName: "Kone", dateOfBirth: "2003-11-04", phone: "+22890000088" },
  { niu: "0000-000-0089", firstName: "Tatiana", lastName: "Lopes", dateOfBirth: "1989-06-26", phone: "+22890000089" },
  { niu: "0000-000-0090", firstName: "Viviane", lastName: "Martin", dateOfBirth: "1998-10-13", phone: "+22890000090" },
  { niu: "0000-000-0091", firstName: "Amélie", lastName: "Nana", dateOfBirth: "1984-08-17", phone: "+22890000091" },
  { niu: "0000-000-0092", firstName: "Blandine", lastName: "Ouro", dateOfBirth: "1977-08-11", phone: "+22890000092" },
  { niu: "0000-000-0093", firstName: "Carine", lastName: "Paul", dateOfBirth: "1976-02-13", phone: "+22890000093" },
  { niu: "0000-000-0094", firstName: "Delphine", lastName: "Robert", dateOfBirth: "1988-08-12", phone: "+22890000094" },
  { niu: "0000-000-0095", firstName: "Estelle", lastName: "Sylla", dateOfBirth: "1975-12-09", phone: "+22890000095" },
  { niu: "0000-000-0096", firstName: "Fanny", lastName: "Traore", dateOfBirth: "1996-02-12", phone: "+22890000096" },
  { niu: "0000-000-0097", firstName: "Gladys", lastName: "Ville", dateOfBirth: "1980-06-12", phone: "+22890000097" },
  { niu: "0000-000-0098", firstName: "Henriette", lastName: "Wade", dateOfBirth: "2000-07-17", phone: "+22890000098" },
  { niu: "0000-000-0099", firstName: "Ida", lastName: "Yao", dateOfBirth: "1979-05-09", phone: "+22890000099" },
  { niu: "0000-000-0100", firstName: "Jocelyne", lastName: "Zakari", dateOfBirth: "1983-10-08", phone: "+22890000100" },
];

// Compares names ignoring capitals, extra spaces and accents (D12, D132):
// "helene", "Hélène" and " HELENE " are the same name.
export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

// The name as the record holds it: "Akossiwa Mensah".
const fullNameOf = (r: AnidRecord) => `${r.firstName} ${r.lastName}`;

// D132: the app sends the first name and the surname apart; an older app sends
// one full name, read in either order ("Akossiwa Mensah" or "Mensah Akossiwa").
function namesMatch(r: AnidRecord, d: IdentityDetails): boolean {
  if (d.firstName !== undefined || d.lastName !== undefined) {
    return normalizeName(d.firstName ?? "") === normalizeName(r.firstName) && normalizeName(d.lastName ?? "") === normalizeName(r.lastName);
  }
  if (d.fullName === undefined) return true; // USSD: no name typed, the record gives it
  const typed = normalizeName(d.fullName);
  return typed === normalizeName(`${r.firstName} ${r.lastName}`) || typed === normalizeName(`${r.lastName} ${r.firstName}`);
}

// Shows only the last four digits, so the member knows which phone
// receives the code without the full number being revealed.
function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)} ** ** ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

// Stands in for ANID during the demo. Holds pending codes in memory,
// so they are lost if the API restarts.
export class MockAnidProvider implements IdentityProvider {
  // Codes "sent" by the mock, readable by tests. A real service never exposes them.
  readonly sentCodes = new Map<string, string>();
  private readonly pending = new Map<string, PendingVerification>();

  async startVerification(details: IdentityDetails): Promise<StartVerificationResult> {
    // D132: the ID number, the first name, the surname and the date of birth
    // must all match the record, as with ANID (D12).
    const record = DEMO_REGISTER.find(
      (r) => r.niu === details.niu.trim() && namesMatch(r, details) && r.dateOfBirth === details.dateOfBirth,
    );
    if (!record) return { kind: "NO_MATCH" };

    const transactionId = randomUUID();
    // A cryptographically secure random number, padded to 6 digits.
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.pending.set(transactionId, {
      code,
      expiresAt: Date.now() + CODE_LIFETIME_MS,
      attemptsLeft: MAX_CODE_ATTEMPTS,
      // The name kept is always the record's (D132), as ANID returns it.
      fullName: fullNameOf(record),
    });
    this.sentCodes.set(transactionId, code);
    console.log(`[mock ANID] code ${code} sent to ${record.phone}`);

    return { kind: "CODE_SENT", transactionId, maskedPhone: maskPhone(record.phone) };
  }

  async confirmVerification(transactionId: string, code: string): Promise<ConfirmVerificationResult> {
    const pending = this.pending.get(transactionId);
    if (!pending || Date.now() > pending.expiresAt) {
      this.pending.delete(transactionId);
      return { kind: "EXPIRED" };
    }

    if (code !== pending.code) {
      pending.attemptsLeft -= 1;
      if (pending.attemptsLeft === 0) {
        this.pending.delete(transactionId);
        return { kind: "EXPIRED" };
      }
      return { kind: "CODE_INVALID", attemptsLeft: pending.attemptsLeft };
    }

    this.pending.delete(transactionId);
    return { kind: "VERIFIED", fullName: pending.fullName };
  }
}
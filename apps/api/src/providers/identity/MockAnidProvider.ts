import { randomInt, randomUUID } from "node:crypto";
import type {
  ConfirmVerificationResult,
  IdentityDetails,
  IdentityProvider,
  StartVerificationResult,
} from "./IdentityProvider.js";

// A record in the fake register. NIU values are invented for the demo but
// follow the card's format, 4-3-4 digits (1234-234-2344); every demo number
// starts with 0000 so it can never be a real person's.
type AnidRecord = { niu: string; fullName: string; dateOfBirth: string; phone: string };

type PendingVerification = { code: string; expiresAt: number; attemptsLeft: number };

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 3;

// Demo identity register: 100 invented people for the pilot's testers
// (docs/test-identities.md). 1 January is a common recorded date when a
// person's exact date of birth is unknown.
const DEMO_REGISTER: AnidRecord[] = [
  { niu: "0000-000-0001", fullName: "AKOSSIWA AFI MENSAH", dateOfBirth: "1984-03-12", phone: "+22890000001" },
  { niu: "0000-000-0002", fullName: "ABLA DZIFA AGBEKO", dateOfBirth: "1990-07-25", phone: "+22890000002" },
  { niu: "0000-000-0003", fullName: "KOFFI SELOM AMEGAH", dateOfBirth: "1979-01-01", phone: "+22890000003" },
  { niu: "0000-000-0004", fullName: "ADJOA MAWUENA KPODAR", dateOfBirth: "1988-05-04", phone: "+22890000004" },
  { niu: "0000-000-0005", fullName: "AMA ESSI LAWSON", dateOfBirth: "1992-11-19", phone: "+22890000005" },
  { niu: "0000-000-0006", fullName: "AFI YAWA DOGBE", dateOfBirth: "1986-02-27", phone: "+22890000006" },
  { niu: "0000-000-0007", fullName: "KAFUI EDEM AHIANYO", dateOfBirth: "1995-09-08", phone: "+22890000007" },
  { niu: "0000-000-0008", fullName: "SENAM AKU KOUDJO", dateOfBirth: "1991-06-30", phone: "+22890000008" },
  { niu: "0000-000-0009", fullName: "ENYONAM AFIWA ATTISSO", dateOfBirth: "1983-12-15", phone: "+22890000009" },
  { niu: "0000-000-0010", fullName: "DELALI SITSOFE GBADOE", dateOfBirth: "1997-04-21", phone: "+22890000010" },
  { niu: "0000-000-0011", fullName: "ESSOWAZINA AFI PALANGA", dateOfBirth: "1989-08-03", phone: "+22890000011" },
  { niu: "0000-000-0012", fullName: "MAGNOUDEWA ABRA TCHALLA", dateOfBirth: "1985-01-01", phone: "+22890000012" },
  { niu: "0000-000-0013", fullName: "AYOKO PRISCA AKAKPO", dateOfBirth: "1993-03-17", phone: "+22890000013" },
  { niu: "0000-000-0014", fullName: "NADEGE AMIVI KPATCHA", dateOfBirth: "1990-10-09", phone: "+22890000014" },
  { niu: "0000-000-0015", fullName: "FOLLY KOMLA AGBODJAN", dateOfBirth: "1982-07-14", phone: "+22890000015" },
  { niu: "0000-000-0016", fullName: "YAWO ELOM MESSAN", dateOfBirth: "1994-02-02", phone: "+22890000016" },
  { niu: "0000-000-0017", fullName: "SEFAKO AFI ALOGNON", dateOfBirth: "1987-11-28", phone: "+22890000017" },
  { niu: "0000-000-0018", fullName: "BLEWUSSI AMA ADANLETE", dateOfBirth: "1996-05-23", phone: "+22890000018" },
  { niu: "0000-000-0019", fullName: "ABLAVI KOKOE SOSSOU", dateOfBirth: "1981-09-12", phone: "+22890000019" },
  { niu: "0000-000-0020", fullName: "TCHILALO ESSI BODJONA", dateOfBirth: "1998-12-06", phone: "+22890000020" },
  { niu: "0000-000-0021", fullName: "AFIAVI ENYONAM EDOH", dateOfBirth: "1986-08-19", phone: "+22890000021" },
  { niu: "0000-000-0022", fullName: "KOMLA YAWA ADJAVON", dateOfBirth: "1980-05-23", phone: "+22890000022" },
  { niu: "0000-000-0023", fullName: "KODJO AMIVI SEGBEDZI", dateOfBirth: "1997-10-07", phone: "+22890000023" },
  { niu: "0000-000-0024", fullName: "EYRAM ENYONAM PALI", dateOfBirth: "1999-08-27", phone: "+22890000024" },
  { niu: "0000-000-0025", fullName: "VICTOIRE SENAM LASSEY", dateOfBirth: "1988-10-14", phone: "+22890000025" },
  { niu: "0000-000-0026", fullName: "KOSSI KOKOE AMEGEE", dateOfBirth: "1989-06-03", phone: "+22890000026" },
  { niu: "0000-000-0027", fullName: "AKPENE SITSOFE HOUNKPATI", dateOfBirth: "1991-06-12", phone: "+22890000027" },
  { niu: "0000-000-0028", fullName: "EYRAM KOMLA AMOUZOU", dateOfBirth: "1978-10-13", phone: "+22890000028" },
  { niu: "0000-000-0029", fullName: "DZIGBODI ABLA DJOSSOU", dateOfBirth: "1991-02-09", phone: "+22890000029" },
  { niu: "0000-000-0030", fullName: "KAYI SITSOFE ATAYI", dateOfBirth: "1990-03-10", phone: "+22890000030" },
  { niu: "0000-000-0031", fullName: "VICTOIRE AFIWA ATAYI", dateOfBirth: "1992-02-28", phone: "+22890000031" },
  { niu: "0000-000-0032", fullName: "YAWA DZIFA ESSOBIYOU", dateOfBirth: "1989-03-25", phone: "+22890000032" },
  { niu: "0000-000-0033", fullName: "DELA KOMLA APEDO", dateOfBirth: "1984-08-23", phone: "+22890000033" },
  { niu: "0000-000-0034", fullName: "ATSUFI ABLA AGBENYEGA", dateOfBirth: "1986-01-15", phone: "+22890000034" },
  { niu: "0000-000-0035", fullName: "KOKOU YAWA SEGBEDZI", dateOfBirth: "2002-01-11", phone: "+22890000035" },
  { niu: "0000-000-0036", fullName: "EYRAM MAWUENA TOSSOU", dateOfBirth: "1985-08-10", phone: "+22890000036" },
  { niu: "0000-000-0037", fullName: "AMELE AMIVI AKPABLI", dateOfBirth: "1991-10-14", phone: "+22890000037" },
  { niu: "0000-000-0038", fullName: "MARTHE SENAM DOSSOU", dateOfBirth: "1985-04-10", phone: "+22890000038" },
  { niu: "0000-000-0039", fullName: "MASSAN YAWA SOGLO", dateOfBirth: "2001-10-23", phone: "+22890000039" },
  { niu: "0000-000-0040", fullName: "ABLA KOMLA KPELI", dateOfBirth: "2004-03-16", phone: "+22890000040" },
  { niu: "0000-000-0041", fullName: "KOSSIWA KOMLA PALI", dateOfBirth: "1973-08-10", phone: "+22890000041" },
  { niu: "0000-000-0042", fullName: "EYRAM SENAM FIAGBE", dateOfBirth: "1996-02-16", phone: "+22890000042" },
  { niu: "0000-000-0043", fullName: "AMA ELOM AFANOU", dateOfBirth: "1993-10-24", phone: "+22890000043" },
  { niu: "0000-000-0044", fullName: "AKOUVI AMA ATAYI", dateOfBirth: "1997-01-01", phone: "+22890000044" },
  { niu: "0000-000-0045", fullName: "YAWA MAWUENA KUDZO", dateOfBirth: "1985-02-19", phone: "+22890000045" },
  { niu: "0000-000-0046", fullName: "ESSOHAM AFIWA AYIVI", dateOfBirth: "1987-01-03", phone: "+22890000046" },
  { niu: "0000-000-0047", fullName: "DELA AKOSSIWA AMENYO", dateOfBirth: "1996-10-12", phone: "+22890000047" },
  { niu: "0000-000-0048", fullName: "KOKOU KOKOE KAREWA", dateOfBirth: "1978-10-27", phone: "+22890000048" },
  { niu: "0000-000-0049", fullName: "AFI EDEM TAKPARA", dateOfBirth: "2001-01-18", phone: "+22890000049" },
  { niu: "0000-000-0050", fullName: "KOSSI ABLA ZINSOU", dateOfBirth: "1992-05-23", phone: "+22890000050" },
  { niu: "0000-000-0051", fullName: "AFIAVI ABLA SEDZRO", dateOfBirth: "1994-02-15", phone: "+22890000051" },
  { niu: "0000-000-0052", fullName: "ABLA AMIVI ABALO", dateOfBirth: "1972-03-14", phone: "+22890000052" },
  { niu: "0000-000-0053", fullName: "VICTOIRE DZIFA KUDZO", dateOfBirth: "1985-12-08", phone: "+22890000053" },
  { niu: "0000-000-0054", fullName: "DELA AFIWA ADJAVON", dateOfBirth: "1992-12-24", phone: "+22890000054" },
  { niu: "0000-000-0055", fullName: "GERTRUDE KOMLA TAKPARA", dateOfBirth: "1976-08-28", phone: "+22890000055" },
  { niu: "0000-000-0056", fullName: "EDEM ENYONAM AMEGEE", dateOfBirth: "1993-09-13", phone: "+22890000056" },
  { niu: "0000-000-0057", fullName: "MASSAN EDEM KAREWA", dateOfBirth: "1995-07-02", phone: "+22890000057" },
  { niu: "0000-000-0058", fullName: "ATSUFI ELOM FIAGBE", dateOfBirth: "1988-06-19", phone: "+22890000058" },
  { niu: "0000-000-0059", fullName: "DJIFA SENAM ATAYI", dateOfBirth: "1996-10-20", phone: "+22890000059" },
  { niu: "0000-000-0060", fullName: "KODJO SENAM AFANOU", dateOfBirth: "1995-02-26", phone: "+22890000060" },
  { niu: "0000-000-0061", fullName: "EYRAM EDEM EDOH", dateOfBirth: "1999-05-12", phone: "+22890000061" },
  { niu: "0000-000-0062", fullName: "YAYRA AMA TETEVI", dateOfBirth: "1991-04-15", phone: "+22890000062" },
  { niu: "0000-000-0063", fullName: "DZIGBODI AKOSSIWA KPELI", dateOfBirth: "1975-03-06", phone: "+22890000063" },
  { niu: "0000-000-0064", fullName: "AKPENE ELOM SOGLO", dateOfBirth: "2003-05-17", phone: "+22890000064" },
  { niu: "0000-000-0065", fullName: "KOKOU SELOM KAREWA", dateOfBirth: "1979-09-13", phone: "+22890000065" },
  { niu: "0000-000-0066", fullName: "KODJO ELOM BASSAH", dateOfBirth: "1992-08-14", phone: "+22890000066" },
  { niu: "0000-000-0067", fullName: "AFI SENAM KANGNI", dateOfBirth: "1980-04-11", phone: "+22890000067" },
  { niu: "0000-000-0068", fullName: "DJIFA KOMLA SOGLO", dateOfBirth: "2003-10-21", phone: "+22890000068" },
  { niu: "0000-000-0069", fullName: "GERTRUDE SELOM GBEDEMAH", dateOfBirth: "1979-06-16", phone: "+22890000069" },
  { niu: "0000-000-0070", fullName: "AKPENE ESSI ADJAVON", dateOfBirth: "1976-12-11", phone: "+22890000070" },
  { niu: "0000-000-0071", fullName: "YAYRA SENAM KLUTSE", dateOfBirth: "2002-06-11", phone: "+22890000071" },
  { niu: "0000-000-0072", fullName: "AYELE DZIFA AKUE", dateOfBirth: "1998-09-23", phone: "+22890000072" },
  { niu: "0000-000-0073", fullName: "AKOUVI EDEM QUASHIE", dateOfBirth: "1993-03-22", phone: "+22890000073" },
  { niu: "0000-000-0074", fullName: "MAWULOLO ESSI ZINSOU", dateOfBirth: "1987-10-06", phone: "+22890000074" },
  { niu: "0000-000-0075", fullName: "KAYI DZIFA DOSSOU", dateOfBirth: "1989-08-16", phone: "+22890000075" },
  { niu: "0000-000-0076", fullName: "NOELIE SITSOFE TAKPARA", dateOfBirth: "2004-04-10", phone: "+22890000076" },
  { niu: "0000-000-0077", fullName: "AYELE SITSOFE BASSAH", dateOfBirth: "1997-07-24", phone: "+22890000077" },
  { niu: "0000-000-0078", fullName: "ABRA ESSI SOGLO", dateOfBirth: "1983-01-16", phone: "+22890000078" },
  { niu: "0000-000-0079", fullName: "VICTOIRE ENYONAM AMEGEE", dateOfBirth: "1995-03-02", phone: "+22890000079" },
  { niu: "0000-000-0080", fullName: "YAWA MAWUENA FIAGBE", dateOfBirth: "2001-05-16", phone: "+22890000080" },
  { niu: "0000-000-0081", fullName: "FAFA AFIWA KANGNI", dateOfBirth: "2003-03-28", phone: "+22890000081" },
  { niu: "0000-000-0082", fullName: "AMELE MAWUENA LASSEY", dateOfBirth: "1995-03-22", phone: "+22890000082" },
  { niu: "0000-000-0083", fullName: "AYELE AKOSSIWA KANGNI", dateOfBirth: "1974-09-04", phone: "+22890000083" },
  { niu: "0000-000-0084", fullName: "MAWULI AKU KUDZO", dateOfBirth: "1977-08-06", phone: "+22890000084" },
  { niu: "0000-000-0085", fullName: "ELIKEM ELOM AKPABLI", dateOfBirth: "1975-07-06", phone: "+22890000085" },
  { niu: "0000-000-0086", fullName: "AMELE KOKOE DOGO", dateOfBirth: "1997-03-23", phone: "+22890000086" },
  { niu: "0000-000-0087", fullName: "MARTHE ESSI AKUE", dateOfBirth: "1993-05-18", phone: "+22890000087" },
  { niu: "0000-000-0088", fullName: "EDEM ELOM DJOSSOU", dateOfBirth: "2003-11-04", phone: "+22890000088" },
  { niu: "0000-000-0089", fullName: "KOMLA KOKOE GBEDEMAH", dateOfBirth: "1989-06-26", phone: "+22890000089" },
  { niu: "0000-000-0090", fullName: "MAWULOLO MAWUENA TOSSOU", dateOfBirth: "1998-10-13", phone: "+22890000090" },
  { niu: "0000-000-0091", fullName: "ATSUFI ENYONAM TAKPARA", dateOfBirth: "1984-08-17", phone: "+22890000091" },
  { niu: "0000-000-0092", fullName: "GERTRUDE YAWA KANGNI", dateOfBirth: "1977-08-11", phone: "+22890000092" },
  { niu: "0000-000-0093", fullName: "ABLA SELOM QUASHIE", dateOfBirth: "1976-02-13", phone: "+22890000093" },
  { niu: "0000-000-0094", fullName: "EYRAM AKOSSIWA AMENYO", dateOfBirth: "1988-08-12", phone: "+22890000094" },
  { niu: "0000-000-0095", fullName: "JOSEPHINE SELOM BATAKA", dateOfBirth: "1975-12-09", phone: "+22890000095" },
  { niu: "0000-000-0096", fullName: "ADZO YAWA FIAGBE", dateOfBirth: "1996-02-12", phone: "+22890000096" },
  { niu: "0000-000-0097", fullName: "GERTRUDE AMA TOSSOU", dateOfBirth: "1980-06-12", phone: "+22890000097" },
  { niu: "0000-000-0098", fullName: "EDEM AKU AKUE", dateOfBirth: "2000-07-17", phone: "+22890000098" },
  { niu: "0000-000-0099", fullName: "ELIKEM SITSOFE SOGLO", dateOfBirth: "1979-05-09", phone: "+22890000099" },
  { niu: "0000-000-0100", fullName: "ESSOHAM AKOSSIWA BASSAH", dateOfBirth: "1983-10-08", phone: "+22890000100" },
];

// Compares names ignoring capitals and extra spaces; accents and the order
// of names must match exactly (D12).
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
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
    const record = DEMO_REGISTER.find(
      (r) =>
        r.niu === details.niu.trim() &&
        normalizeName(r.fullName) === normalizeName(details.fullName) &&
        r.dateOfBirth === details.dateOfBirth,
    );
    if (!record) return { kind: "NO_MATCH" };

    const transactionId = randomUUID();
    // A cryptographically secure random number, padded to 6 digits.
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.pending.set(transactionId, {
      code,
      expiresAt: Date.now() + CODE_LIFETIME_MS,
      attemptsLeft: MAX_CODE_ATTEMPTS,
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
    return { kind: "VERIFIED" };
  }
}
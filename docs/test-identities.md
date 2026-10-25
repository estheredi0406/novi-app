# Demo identities for testers

The identity check (ANID) is still a mock (D3). It only accepts these demo
identities, built into `apps/api/src/providers/identity/MockAnidProvider.ts`.
They are invented: none is a real person's NIU. Each one can create a single
account, so give each tester a different line and note who has which.

The verification code appears in the server logs (search `mock ANID`), and
the sign-up SMS code under `mock SMS`.

| NIU | Full name | Date of birth |
|---|---|---|
| `TEST-0001` | Akossiwa Afi Mensah | 12/03/1984 |
| `TEST-0002` | Abla Dzifa Agbeko | 25/07/1990 |
| `TEST-0003` | Koffi Selom Amegah | 01/01/1979 |
| `TEST-0004` | Adjoa Mawuena Kpodar | 04/05/1988 |
| `TEST-0005` | Ama Essi Lawson | 19/11/1992 |
| `TEST-0006` | Afi Yawa Dogbe | 27/02/1986 |
| `TEST-0007` | Kafui Edem Ahianyo | 08/09/1995 |
| `TEST-0008` | Senam Aku Koudjo | 30/06/1991 |
| `TEST-0009` | Enyonam Afiwa Attisso | 15/12/1983 |
| `TEST-0010` | Delali Sitsofe Gbadoe | 21/04/1997 |
| `TEST-0011` | Essowazina Afi Palanga | 03/08/1989 |
| `TEST-0012` | Magnoudewa Abra Tchalla | 01/01/1985 |
| `TEST-0013` | Ayoko Prisca Akakpo | 17/03/1993 |
| `TEST-0014` | Nadege Amivi Kpatcha | 09/10/1990 |
| `TEST-0015` | Folly Komla Agbodjan | 14/07/1982 |
| `TEST-0016` | Yawo Elom Messan | 02/02/1994 |
| `TEST-0017` | Sefako Afi Alognon | 28/11/1987 |
| `TEST-0018` | Blewussi Ama Adanlete | 23/05/1996 |
| `TEST-0019` | Ablavi Kokoe Sossou | 12/09/1981 |
| `TEST-0020` | Tchilalo Essi Bodjona | 06/12/1998 |

Capitals and extra spaces in the name do not matter; the date must be exact.

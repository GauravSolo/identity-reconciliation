import { PrismaClient, Contact } from "@prisma/client";

const prisma = new PrismaClient();

interface IdentifyResponse {
  contact: {
    primaryContatctId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

export async function identifyContact(
  email: string | null,
  phoneNumber: string | null
): Promise<IdentifyResponse> {

  // Find all matching contacts
  const whereConditions = [];
  if (email) whereConditions.push({ email });
  if (phoneNumber) whereConditions.push({ phoneNumber });

  const matchingContacts = await prisma.contact.findMany({
    where: {
      OR: whereConditions,
      deletedAt: null,
    },
  });

  // No matches — create new primary
  if (matchingContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary",
      },
    });
    return formatResponse(newContact, []);
  }

  // Resolve all distinct primary IDs
  const primaryIds = new Set<number>();
  for (const contact of matchingContacts) {
    if (contact.linkPrecedence === "primary") {
      primaryIds.add(contact.id);
    } else if (contact.linkedId) {
      primaryIds.add(contact.linkedId);
    }
  }

  // Fetch all primary contacts
  const primaries = await prisma.contact.findMany({
    where: { id: { in: Array.from(primaryIds) }, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  // If multiple primaries, merge — oldest stays primary
  let survivingPrimary = primaries[0];

  if (primaries.length > 1) {
    const demotedPrimaries = primaries.slice(1);
    const demotedIds = demotedPrimaries.map((p) => p.id);

    // Demote newer primaries to secondary
    await prisma.contact.updateMany({
      where: { id: { in: demotedIds } },
      data: {
        linkedId: survivingPrimary.id,
        linkPrecedence: "secondary",
      },
    });

    await prisma.contact.updateMany({
      where: { linkedId: { in: demotedIds }, deletedAt: null },
      data: { linkedId: survivingPrimary.id },
    });
  }

  // Fetch the full consolidated group
  const allSecondaries = await prisma.contact.findMany({
    where: { linkedId: survivingPrimary.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  const freshPrimary = await prisma.contact.findUnique({
    where: { id: survivingPrimary.id },
  });
  if (freshPrimary) survivingPrimary = freshPrimary;

  // Check if we need to create a new secondary (new info not in group)
  const allContacts = [survivingPrimary, ...allSecondaries];
  const existingEmails = new Set(allContacts.map((c) => c.email).filter(Boolean));
  const existingPhones = new Set(allContacts.map((c) => c.phoneNumber).filter(Boolean));

  const hasNewEmail = email && !existingEmails.has(email);
  const hasNewPhone = phoneNumber && !existingPhones.has(phoneNumber);

  // If exact combo already exists, don't create duplicate
  const exactMatchExists = allContacts.some(
    (c) => c.email === email && c.phoneNumber === phoneNumber
  );

  if ((hasNewEmail || hasNewPhone) && !exactMatchExists) {
    const newSecondary = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkedId: survivingPrimary.id,
        linkPrecedence: "secondary",
      },
    });
    allSecondaries.push(newSecondary);
  }

  return formatResponse(survivingPrimary, allSecondaries);
}

function formatResponse(primary: Contact, secondaries: Contact[]): IdentifyResponse {
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];

  // Primary first
  if (primary.email) emails.push(primary.email);
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);

  // Then secondaries
  for (const sec of secondaries) {
    secondaryContactIds.push(sec.id);
    if (sec.email && !emails.includes(sec.email)) emails.push(sec.email);
    if (sec.phoneNumber && !phoneNumbers.includes(sec.phoneNumber)) phoneNumbers.push(sec.phoneNumber);
  }

  return {
    contact: {
      primaryContatctId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds,
    },
  };
}

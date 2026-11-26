import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProfile, type ProfileSpec } from '../../scripts/lib/write-profile.ts';
import { createKursClient, kursUrl, type KursClient } from '../../src/integrations/kurs/client.ts';

const SELLER = { name: 'Milica Testović PR', pib: '100000001', address: 'Bulevar Probni 1, Beograd' };

/** A small synthetic profile: one EUR invoice, two RSD invoices, an unexplained payment, two book errors. */
export function smallProfile(): ProfileSpec {
  return {
    profile: {
      id: 't01',
      name: 'Milica Testović PR',
      pib: '100000001',
      activityCode: '6201',
      registrationDate: '2023-01-10',
      municipality: 'Beograd',
      address: 'Bulevar Probni 1, Beograd',
      activityExemptFromIndependenceTest: false,
      year: 2026,
      asOf: '2026-11-26',
    },
    clients: [
      {
        id: 'kestrel',
        name: 'Kestrel Analytics GmbH',
        country: 'DE',
        isBusiness: true,
        vatId: 'DE000000001',
        contract: {
          workingHoursSetByClient: 'Yes: the client sets core hours 10-16.',
          workplaceSetByClient: 'No: work is done remotely from the contractor office.',
          trainingByClient: 'No',
          equipmentOrManagementByClient: 'Yes: the client provides a laptop.',
          clientLineOfBusinessWithoutRiskClause: 'Yes: no clause on business risk.',
          nonCompeteClause: '',
        },
      },
      {
        id: 'javor',
        name: 'Javor Softver d.o.o.',
        country: 'RS',
        isBusiness: true,
        pib: '100000002',
        contract: {
          workingHoursSetByClient: 'No',
          workplaceSetByClient: 'No',
          trainingByClient: 'No',
          equipmentOrManagementByClient: 'No',
          clientLineOfBusinessWithoutRiskClause: 'No: the contractor bears delivery risk.',
          nonCompeteClause: 'No',
        },
      },
    ],
    draft: {
      clientId: 'kestrel',
      currency: 'EUR',
      amount: '5000.00',
      issueDate: '2026-11-26',
      description: 'Development, November',
      kind: 'service',
    },
    invoices: [
      {
        number: '2026-001',
        issueDate: '2026-03-02',
        supplyDate: '2026-03-02',
        seller: SELLER,
        client: {
          name: 'Javor Softver d.o.o.',
          address: 'Ulica Javora 5, Novi Sad',
          countryName: 'Srbija',
          taxId: '100000002',
        },
        currency: 'RSD',
        amount: '1200000.00',
        kind: 'service',
        lineText: 'Razvoj softvera, februar 2026',
        template: 'A',
      },
      {
        number: '2026-002',
        issueDate: '2026-11-20',
        seller: SELLER,
        client: {
          name: 'Kestrel Analytics GmbH',
          address: 'Probestraße 9, Berlin',
          countryName: 'Nemačka',
          taxId: 'DE000000001',
        },
        currency: 'EUR',
        amount: '4000.00',
        kind: 'service',
        lineText: 'Software development, October 2026',
        template: 'B',
      },
      {
        number: '2026-003',
        issueDate: '2026-06-15',
        seller: SELLER,
        client: {
          name: 'Javor Softver d.o.o.',
          address: 'Ulica Javora 5, Novi Sad',
          countryName: 'Srbija',
          taxId: '100000002',
        },
        currency: 'RSD',
        amount: '300000.00',
        kind: 'product',
        lineText: 'Licenca za alat, 10 komada',
        template: 'A',
      },
    ],
    statement: [
      {
        date: '2026-03-10',
        valueDate: '2026-03-10',
        description: 'Uplata po fakturi 2026-001',
        counterparty: 'Javor Softver d.o.o.',
        reference: '2026-001',
        amount: '1200000.00',
        currency: 'RSD',
        direction: 'PRILIV',
        balance: '1200000.00',
      },
      {
        date: '2026-06-20',
        valueDate: '2026-06-20',
        description: 'Uplata po fakturi 2026-003',
        counterparty: 'Javor Softver d.o.o.',
        reference: '2026-003',
        amount: '300000.00',
        currency: 'RSD',
        direction: 'PRILIV',
        balance: '1500000.00',
      },
      {
        date: '2026-09-05',
        valueDate: '2026-09-05',
        description: 'Uplata za konsultacije',
        counterparty: 'Lipa Studio',
        reference: '',
        amount: '250000.00',
        currency: 'RSD',
        direction: 'PRILIV',
        balance: '1750000.00',
      },
      {
        date: '2026-09-30',
        valueDate: '2026-09-30',
        description: 'Provizija banke',
        counterparty: 'Banka',
        reference: '',
        amount: '1500.00',
        currency: 'RSD',
        direction: 'ODLIV',
        balance: '1748500.00',
      },
      {
        date: '2026-11-24',
        valueDate: '2026-11-24',
        description: 'Uplata po fakturi 2026-002',
        counterparty: 'Kestrel Analytics GmbH',
        reference: '2026-002',
        amount: '470564.80',
        currency: 'RSD',
        direction: 'PRILIV',
        balance: '2219064.80',
      },
    ],
    kpo: [
      {
        date: '2026-03-10',
        description: 'Faktura 2026-001 Javor Softver',
        products: '0.00',
        services: '1200000.00',
        total: '1200000.00',
      },
      {
        date: '2026-11-20',
        description: 'Faktura 2026-002 Kestrel Analytics',
        products: '0.00',
        services: '470564.80',
        total: '470564.80',
      },
    ],
  };
}

export async function writeTempProfile(spec: ProfileSpec): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `headroom-${spec.profile.id}-`));
  await writeProfile(dir, spec);
  return dir;
}

/** A Kurs client answering from the recorded fixtures in test/fixtures/kurs. */
export function fixtureKurs(now: () => number): KursClient {
  const files: Record<string, string> = {
    [kursUrl('EUR', '2026-11-20')]: 'eur-2026-11-20.json',
    [kursUrl('EUR', '2026-11-21')]: 'eur-2026-11-21.json',
    [kursUrl('EUR', '2026-11-22')]: 'eur-2026-11-22.json',
    [kursUrl('EUR', '2026-11-26')]: 'eur-2026-11-26-today.json',
    [kursUrl('EUR', '2026-03-14')]: 'eur-2026-03-14.json',
    [kursUrl('EUR', '2026-01-07')]: 'eur-2026-01-07.json',
    [kursUrl('USD', '2026-11-20')]: 'usd-2026-11-20.json',
  };
  return createKursClient({
    now,
    fetcher: async (url) => {
      const f = files[url];
      return f
        ? { status: 200, body: readFileSync(join('test/fixtures/kurs', f), 'utf8') }
        : { status: 503, body: 'not in fixtures' };
    },
    sleep: async () => {},
  });
}

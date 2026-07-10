import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { connectDB } from './db';
import { Inquiry } from './models/Inquiry';
import { Doc } from './models/Document';
import { Lead } from './models/Lead';

const inquiries = [
  {
    inquiryId: 'OEL/EST/2026/0411',
    client: 'TCE',
    project: 'IOCL Paradip',
    scope: 'Chemical Dosing Skid',
    value: 2.07,
    currency: 'USD' as const,
    valueUnit: 'Mn' as const,
    priority: 'P2' as const,
    currentStage: 2,
    currentStageName: 'Document Review',
    cluster: 'intake' as const,
    daysToBid: -68,
    bidDue: '12-Apr',
    receivedDate: '2026-03-01',
    source: 'Direct intake',
    estimator: 'Sneha Bharti',
    completedUpTo: 1,
  },
  {
    inquiryId: 'OEL/EST/2026/0418',
    client: 'EIL',
    project: 'BPCL Bina',
    scope: 'Heat Exchangers CS/LTCS',
    value: 15.86,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    priority: 'P1' as const,
    currentStage: 7,
    currentStageName: 'Estimation In Progress',
    cluster: 'estimation' as const,
    daysToBid: -72,
    bidDue: '08-Apr',
    receivedDate: '2026-03-05',
    source: 'EPC Tender',
    estimator: 'Rajan Mehta',
    completedUpTo: 6,
  },
  {
    inquiryId: 'OEL/EST/2026/0404',
    client: 'Wood',
    project: 'QatarEnergy LNG',
    scope: 'Surge Drum + Reflux Drum',
    value: 1.45,
    currency: 'USD' as const,
    valueUnit: 'Mn' as const,
    priority: 'P2' as const,
    currentStage: 6,
    currentStageName: 'Man-Hour Estimation',
    cluster: 'estimation' as const,
    daysToBid: -58,
    bidDue: '22-Apr',
    receivedDate: '2026-03-08',
    source: 'Client Portal',
    estimator: 'Priya Nair',
    completedUpTo: 5,
  },
  {
    inquiryId: 'OEL/EST/2026/0401',
    client: 'Petrofac',
    project: 'ADNOC Hail',
    scope: 'Filter Coalescer Package',
    value: 3.10,
    currency: 'USD' as const,
    valueUnit: 'Mn' as const,
    priority: 'P3' as const,
    currentStage: 3,
    currentStageName: 'Scope Clarification',
    cluster: 'estimation' as const,
    daysToBid: -50,
    bidDue: '30-Apr',
    receivedDate: '2026-03-10',
    source: 'Agent referral',
    estimator: 'Arun Joshi',
    completedUpTo: 2,
  },
  {
    inquiryId: 'OEL/EST/2026/0398',
    client: 'MECON',
    project: 'NRL Numaligarh',
    scope: 'Air Receiver (5 nos)',
    value: 1.10,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    priority: 'P3' as const,
    currentStage: 4,
    currentStageName: 'Material Take-Off',
    cluster: 'estimation' as const,
    daysToBid: -44,
    bidDue: '15-May',
    receivedDate: '2026-03-12',
    source: 'Direct intake',
    estimator: 'Kavita Sharma',
    completedUpTo: 3,
  },
  {
    inquiryId: 'OEL/EST/2026/0407',
    client: 'L&T',
    project: 'ONGC HRJ',
    scope: 'Pig Launcher/Receiver (4 nos)',
    value: 4.20,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    priority: 'P2' as const,
    currentStage: 10,
    currentStageName: 'Bid Submitted',
    cluster: 'bid_active' as const,
    daysToBid: -65,
    bidDue: '15-Mar',
    receivedDate: '2026-02-20',
    source: 'EPC Tender',
    estimator: 'Sneha Bharti',
    completedUpTo: 10,
  },
];

const documents0411 = [
  { docType: 'RFQ', title: 'Request for Quotation', rev: 'A', status: 'read' as const },
  { docType: 'BDS', title: 'Bid Data Sheet', rev: 'A', status: 'read' as const },
  { docType: 'ITB', title: 'Instructions to Bidders + Appendices I–VIII', rev: '0', status: 'read' as const },
  { docType: 'ATC', title: 'Agreed Terms & Conditions', rev: '–', status: 'open' as const },
  { docType: 'SPC', title: 'Special Purchase Conditions', rev: '0', status: 'open' as const },
  { docType: 'GPC', title: 'General Purchase Conditions', rev: '0', status: 'queued' as const },
  { docType: 'PS', title: 'Price Schedule (Format B1)', rev: 'B', status: 'open' as const },
  { docType: 'MR', title: 'Material Requisition — Heat Exchanger CS', rev: 'B', status: 'read' as const },
  { docType: 'SOW', title: 'MR Scope of Work & Supply', rev: 'A', status: 'read' as const },
  { docType: 'TCL', title: 'Technical Compliance Statement (template)', rev: 'B', status: 'open' as const },
];

const documents0407 = [
  { docType: 'RFQ', title: 'Request for Quotation', rev: 'B', status: 'read' as const },
  { docType: 'BDS', title: 'Bid Data Sheet', rev: 'A', status: 'read' as const },
  { docType: 'ITB', title: 'Instructions to Bidders', rev: '0', status: 'read' as const },
  { docType: 'MR', title: 'Material Requisition', rev: 'B', status: 'read' as const },
  { docType: 'TCL', title: 'Technical Compliance Statement', rev: 'A', status: 'read' as const },
];

function daysFromNow(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const leads = [
  {
    leadId: 'L-2849',
    client: 'BPCL Bina Petchem',
    clientType: 'PSU · End User',
    tenderRef: 'B957-300-EE-MR-6340/139',
    title: 'Heat Exchangers — CS / LTCS (12 tags)',
    source: 'EIL Tender Portal',
    value: 15.86,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(6),
    avlStatus: 'approved' as const,
    score: 94,
    assignedTo: 'Sneha B.',
    notes: 'HX core + LTCS capability match. EIL approved, Bina geography fit.',
  },
  {
    leadId: 'L-2848',
    client: 'TCE / IOCL Paradip',
    clientType: 'PSU · EPCM',
    tenderRef: 'TCE/PAR/2026/COND-118',
    title: 'Air-cooled Condenser bank (3 nos)',
    source: 'GeM',
    value: 4.20,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(18),
    avlStatus: 'approved' as const,
    score: 81,
    assignedTo: 'Aaman S.',
    notes: 'EPCM relationship + cooling tech fit. AVL renewal due Q3.',
  },
  {
    leadId: 'L-2847',
    client: 'ONGC Hazira',
    clientType: 'PSU · End User',
    tenderRef: 'ONGC/HAZ/PIG/2026/044',
    title: 'Pig Launchers / Receivers (8 nos, 24in)',
    source: 'ONGC e-Procure',
    value: 5.80,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(25),
    avlStatus: 'approved' as const,
    score: 76,
    assignedTo: 'Rahul J.',
    notes: 'Pig launchers core capability + ONGC AVL. Last delivery was 18in size.',
  },
  {
    leadId: 'L-2846',
    client: 'Adani Petrochem · Mundra',
    clientType: 'Private · End User',
    tenderRef: 'APL/MUN/SD-2026/077',
    title: 'Surge Drum + Reflux Drum package',
    source: 'Google News + Adani Vendor Portal',
    value: 2.80,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(12),
    avlStatus: 'not_registered' as const,
    score: 68,
    assignedTo: 'Priya N.',
    notes: 'Pressure vessels core capability, but not on AVL — new relationship with Adani.',
  },
  {
    leadId: 'L-2845',
    client: 'QatarEnergy LNG (via Wood)',
    clientType: 'EPC · International',
    tenderRef: 'WD-QE-LNG/2026/SD-283',
    title: 'Filter Coalescer Package (skid)',
    source: 'GeM (Wood India)',
    value: 24.80,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(35),
    avlStatus: 'review' as const,
    score: 71,
    assignedTo: 'Aaman S.',
    notes: 'Skidded package + Wood relationship. IECEx certificates in renewal, USD invoicing.',
  },
  {
    leadId: 'L-2844',
    client: 'HPCL Visakh',
    clientType: 'PSU · End User',
    tenderRef: 'HPCL/VSP/AR/2026/091',
    title: 'Air Receivers (6 nos, ASME U)',
    source: 'GeM',
    value: 1.35,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(9),
    avlStatus: 'approved' as const,
    score: 64,
    assignedTo: 'Sneha B.',
    notes: 'ASME U stamp + low-value quick turn, but margin profile is tight.',
  },
  {
    leadId: 'L-2843',
    client: 'TotalEnergies Gabon (via Petrofac)',
    clientType: 'EPC · International',
    tenderRef: 'PF-TG/2026/REC-018',
    title: 'Heat Exchanger — refurb scope',
    source: 'LinkedIn + Petrofac',
    value: 5.60,
    currency: 'INR' as const,
    valueUnit: 'Cr' as const,
    dueDate: daysFromNow(42),
    avlStatus: 'not_registered' as const,
    score: 62,
    assignedTo: 'Rahul J.',
    notes: 'HX scope but refurb, not core new-build. Field service ahead of AVL registration.',
  },
];

async function seed(): Promise<void> {
  await connectDB();

  console.log('Seeding inquiries...');
  for (const inq of inquiries) {
    await Inquiry.findOneAndUpdate(
      { inquiryId: inq.inquiryId },
      inq,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`  Upserted inquiry: ${inq.inquiryId}`);
  }

  console.log('Seeding documents for OEL/EST/2026/0411...');
  for (const d of documents0411) {
    const existing = await Doc.findOne({
      inquiryId: 'OEL/EST/2026/0411',
      docType: d.docType,
      title: d.title,
    });
    if (!existing) {
      await Doc.create({
        inquiryId: 'OEL/EST/2026/0411',
        ...d,
        s3Key: '',
        s3Bucket: '',
        fileName: '',
        fileSize: 0,
        mimeType: '',
        uploadedBy: 'system',
      });
      console.log(`  Created doc: ${d.docType} — ${d.title}`);
    } else {
      console.log(`  Skipped (exists): ${d.docType} — ${d.title}`);
    }
  }

  console.log('Seeding documents for OEL/EST/2026/0407...');
  for (const d of documents0407) {
    const existing = await Doc.findOne({
      inquiryId: 'OEL/EST/2026/0407',
      docType: d.docType,
      title: d.title,
    });
    if (!existing) {
      await Doc.create({
        inquiryId: 'OEL/EST/2026/0407',
        ...d,
        s3Key: '',
        s3Bucket: '',
        fileName: '',
        fileSize: 0,
        mimeType: '',
        uploadedBy: 'system',
      });
      console.log(`  Created doc: ${d.docType} — ${d.title}`);
    } else {
      console.log(`  Skipped (exists): ${d.docType} — ${d.title}`);
    }
  }

  console.log('Seeding leads...');
  for (const lead of leads) {
    await Lead.findOneAndUpdate(
      { leadId: lead.leadId },
      {
        $set: lead,
        $setOnInsert: { status: 'new', pushedInquiryId: null },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`  Upserted lead: ${lead.leadId}`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

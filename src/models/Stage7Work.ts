import mongoose, { Schema, Document } from 'mongoose';

export interface IBomComponent {
  srNo:           string;
  component:      string;
  applicable:     string;
  moc:            string | null;
  mocSource:      string;
  mocFlag:        string | null;
  typeDetail:     string | null;
  remarks:        string;
  weightKg:       number | null;
  quantity:       string;
  unit:           string;
  unitCostPerKg:   number | null;
  materialCost:    number | null;
  fabricationCost: number | null;
  totalCost:       number | null;
  costBasis:       string | null;
}

export interface INozzle {
  mark:        string;
  sizeNps:     string;
  asmeClass:   string;
  schedule:    string;
  facing:      string;
  designation: string;
  mocNeck:     string | null;
  mocFlange:   string | null;
  mocFlag:     string | null;
  totalCost:   number | null;
  costBasis:   string | null;
}

export interface IEquipmentBom {
  tagNo:                     string;
  service:                   string;
  temaClass:                 string;
  exchangerType:             string;
  sizeIdMm:                  number;
  sizeSlMm:                  number;
  noOfShells:                number;
  noOfPassesShell:           number;
  noOfPassesTube:            number;
  designPressureShell:       string;
  designPressureTube:        string;
  designTempShellC:          number;
  designTempTubeC:           number;
  fluidShell:                string;
  fluidTube:                 string;
  corrosionAllowanceShellMm: number;
  corrosionAllowanceTubeMm:  number;
  stressRelieving:           string;
  radiography:               string;
  bundleWeightKg:            number | null;
  emptyWeightKg:             number | null;
  fullWaterWeightKg:         number | null;
  deletedFromScope:          boolean;
  ibrApplicable:             boolean;
  hydrogenService:           boolean;
  bom:                       IBomComponent[];
  nozzleSchedule:            INozzle[];
  totalMaterialCost:         number | null;
  totalFabricationCost:      number | null;
  totalNozzleCost:           number | null;
  specialCost:               number | null;
  inspectionCost:            number | null;
  totalEquipCost:            number | null;
}

export interface IProjectInfo {
  name:       string;
  jobNo:      string;
  client:     string;
  consultant: string;
  prNumber:   string;
  revision:   string;
  date:       string;
}

export interface IStage7Work extends Document {
  inquiryId:   string;
  status:      'pending' | 'processing' | 'done' | 'failed';
  error:       string;
  projectInfo: IProjectInfo;
  equipment:   IEquipmentBom[];
  extractedAt: Date | null;
  createdAt:   Date;
  updatedAt:   Date;
}

const BomComponentSchema = new Schema<IBomComponent>(
  {
    srNo:       { type: String, default: '' },
    component:  { type: String, default: '' },
    applicable: { type: String, default: 'Yes' },
    moc:        { type: String, default: null },
    mocSource:  { type: String, default: 'not_found' },
    mocFlag:    { type: String, default: null },
    typeDetail: { type: String, default: null },
    remarks:    { type: String, default: '' },
    weightKg:        { type: Number, default: null },
    quantity:        { type: String, default: '' },
    unit:            { type: String, default: '' },
    unitCostPerKg:   { type: Number, default: null },
    materialCost:    { type: Number, default: null },
    fabricationCost: { type: Number, default: null },
    totalCost:       { type: Number, default: null },
    costBasis:       { type: String, default: null },
  },
  { _id: false },
);

const NozzleSchema = new Schema<INozzle>(
  {
    mark:        { type: String, default: '' },
    sizeNps:     { type: String, default: '' },
    asmeClass:   { type: String, default: '' },
    schedule:    { type: String, default: '' },
    facing:      { type: String, default: '' },
    designation: { type: String, default: '' },
    mocNeck:     { type: String, default: null },
    mocFlange:   { type: String, default: null },
    mocFlag:     { type: String, default: null },
    totalCost:   { type: Number, default: null },
    costBasis:   { type: String, default: null },
  },
  { _id: false },
);

const EquipmentBomSchema = new Schema<IEquipmentBom>(
  {
    tagNo:                     { type: String, default: '' },
    service:                   { type: String, default: '' },
    temaClass:                 { type: String, default: '' },
    exchangerType:             { type: String, default: '' },
    sizeIdMm:                  { type: Number, default: 0 },
    sizeSlMm:                  { type: Number, default: 0 },
    noOfShells:                { type: Number, default: 1 },
    noOfPassesShell:           { type: Number, default: 1 },
    noOfPassesTube:            { type: Number, default: 1 },
    designPressureShell:       { type: String, default: '' },
    designPressureTube:        { type: String, default: '' },
    designTempShellC:          { type: Number, default: 0 },
    designTempTubeC:           { type: Number, default: 0 },
    fluidShell:                { type: String, default: '' },
    fluidTube:                 { type: String, default: '' },
    corrosionAllowanceShellMm: { type: Number, default: 0 },
    corrosionAllowanceTubeMm:  { type: Number, default: 0 },
    stressRelieving:           { type: String, default: '' },
    radiography:               { type: String, default: '' },
    bundleWeightKg:            { type: Number, default: null },
    emptyWeightKg:             { type: Number, default: null },
    fullWaterWeightKg:         { type: Number, default: null },
    deletedFromScope:          { type: Boolean, default: false },
    ibrApplicable:             { type: Boolean, default: false },
    hydrogenService:           { type: Boolean, default: false },
    bom:                       { type: [BomComponentSchema], default: [] },
    nozzleSchedule:            { type: [NozzleSchema], default: [] },
    totalMaterialCost:         { type: Number, default: null },
    totalFabricationCost:      { type: Number, default: null },
    totalNozzleCost:           { type: Number, default: null },
    specialCost:               { type: Number, default: null },
    inspectionCost:            { type: Number, default: null },
    totalEquipCost:            { type: Number, default: null },
  },
  { _id: false },
);

const ProjectInfoSchema = new Schema<IProjectInfo>(
  {
    name:       { type: String, default: '' },
    jobNo:      { type: String, default: '' },
    client:     { type: String, default: '' },
    consultant: { type: String, default: '' },
    prNumber:   { type: String, default: '' },
    revision:   { type: String, default: '' },
    date:       { type: String, default: '' },
  },
  { _id: false },
);

const Stage7WorkSchema = new Schema<IStage7Work>(
  {
    inquiryId:   { type: String, required: true, unique: true, index: true },
    status:      { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:       { type: String, default: '' },
    projectInfo: { type: ProjectInfoSchema, default: () => ({}) },
    equipment:   { type: [EquipmentBomSchema], default: [] },
    extractedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage7Work = mongoose.model<IStage7Work>('Stage7Work', Stage7WorkSchema);

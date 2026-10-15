// Writes the thin page files for the institution-operations screens, one per
// portal and page in src/lib/ops-routes.json. Existing files are left alone
// unless --force is passed. Run: node scripts/generate-ops-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ops-routes.json'), 'utf8'));
const force = process.argv.includes('--force');

const VIEWS = {
  RoleHome: ["import { RoleHome } from '@/components/ops/role-home';", '<RoleHome />'],
  ApprovalsView: ["import { ApprovalsView } from '@/components/ops/approvals-view';", '<ApprovalsView />'],
  CampusWorldView: ["import { CampusWorldView } from '@/components/campus/campus-world';", '<CampusWorldView />'],
  // One live page for a room, class, teacher, bus, lab, department, zone or the gate (?kind=&id=).
  LiveDetailView: ["import { LiveDetailView } from '@/components/campus/campus-live';", '<LiveDetailView />'],
  CorrespondenceView: ["import { CorrespondenceView } from '@/components/ops/correspondence-view';", '<CorrespondenceView />'],
  ComplianceView: ["import { ComplianceView } from '@/components/ops/compliance-view';", '<ComplianceView />'],
  VerificationView: ["import { VerificationView } from '@/components/ops/verification-view';", '<VerificationView />'],
  EventsView: ["import { EventsView } from '@/components/ops/operations-views';", '<EventsView />'],
  FacilitiesView: ["import { FacilitiesView } from '@/components/ops/operations-views';", '<FacilitiesView />'],
  ContractsView: ["import { ContractsView } from '@/components/ops/operations-views';", '<ContractsView />'],
  GovernanceView: ["import { GovernanceView } from '@/components/ops/governance-view';", '<GovernanceView />'],
  PayrollView: ["import { PayrollView } from '@/components/ops/finance-views';", '<PayrollView />'],
  ProcurementView: ["import { ProcurementView } from '@/components/ops/finance-views';", '<ProcurementView />'],
  BudgetsView: ["import { BudgetsView } from '@/components/ops/finance-views';", '<BudgetsView />'],
  PayslipsView: ["import { PayslipsView } from '@/components/ops/finance-views';", '<PayslipsView />'],
  OrganizationView: ["import { OrganizationView } from '@/components/ops/organization-view';", '<OrganizationView />'],
  InstitutionView: ["import { InstitutionView } from '@/components/ops/organization-view';", '<InstitutionView />'],
  MarketingView: ["import { MarketingView } from '@/components/ops/marketing-view';", '<MarketingView />'],
  NewsroomView: ["import { NewsroomView } from '@/components/ops/newsroom-view';", '<NewsroomView />'],
  'NewsroomView:mentoring': ["import { NewsroomView } from '@/components/ops/newsroom-view';", '<NewsroomView initialTab="mentoring" />'],
  SafeguardingView: ["import { SafeguardingView } from '@/components/ops/safeguarding-view';", '<SafeguardingView />'],
  MySpaceView: ["import { MySpaceView } from '@/components/ops/my-space-view';", '<MySpaceView />'],
  SyllabusView: ["import { SyllabusView } from '@/components/ops/syllabus-view';", '<SyllabusView />'],
  LecturesView: ["import { LecturesView } from '@/components/ops/lectures-view';", '<LecturesView />'],
  MessagingView: ["import { MessagingView } from '@/components/ops/my-space-view';", '<MessagingView />'],
  // Transport and safety.
  FleetView: ["import { FleetView } from '@/components/ops/fleet-view';", '<FleetView />'],
  'FleetView:duty': ["import { FleetView } from '@/components/ops/fleet-view';", '<FleetView mode="duty" />'],
  BusTodayView: ["import { BusTodayView } from '@/components/ops/fleet-view';", '<BusTodayView />'],
  GateView: ["import { GateView } from '@/components/ops/gate-view';", '<GateView />'],
  PickupView: ["import { PickupView } from '@/components/ops/gate-view';", '<PickupView />'],
  OutpassView: ["import { OutpassView } from '@/components/ops/outpass-view';", '<OutpassView />'],
  'OutpassView:mine': ["import { OutpassView } from '@/components/ops/outpass-view';", '<OutpassView mode="mine" />'],
  CameraView: ["import { CameraView } from '@/components/ops/camera-view';", '<CameraView />'],
  CheckInView: ["import { CheckInView } from '@/components/ops/camera-view';", '<CheckInView />'],
  AnalyticsView: ["import { AnalyticsView } from '@/components/ops/analytics-view';", '<AnalyticsView />'],
  QuarterlyReportsView: ["import { QuarterlyReportsView } from '@/components/ops/analytics-view';", '<QuarterlyReportsView />'],
  TasksView: ["import { TasksView } from '@/components/ops/tasks-view';", '<TasksView />'],
  LabsView: ["import { LabsView } from '@/components/ops/labs-view';", '<LabsView />'],
  BillsView: ["import { BillsView } from '@/components/ops/bills-view';", '<BillsView />'],
  ConcessionsView: ["import { ConcessionsView } from '@/components/ops/bills-view';", '<ConcessionsView />'],
  AccountsExportView: ["import { AccountsExportView } from '@/components/ops/bills-view';", '<AccountsExportView />'],
  // PTM, review calls, conversations, staff leave/cover, term report cards.
  PtmView: ["import { PtmView } from '@/components/ops/ptm-view';", '<PtmView />'],
  ReviewCallsView: ["import { ReviewCallsView } from '@/components/ops/review-calls-view';", '<ReviewCallsView />'],
  ConversationsView: ["import { ConversationsView } from '@/components/ops/conversations-view';", '<ConversationsView />'],
  StaffLeaveView: ["import { StaffLeaveView } from '@/components/ops/staff-views';", '<StaffLeaveView />'],
  CoverView: ["import { CoverView } from '@/components/ops/staff-views';", '<CoverView />'],
  TermReportCardsView: ["import { TermReportCardsView } from '@/components/ops/term-report-cards-view';", '<TermReportCardsView />'],
  // Clubs, teams and houses; achievement and top-ranker showcase.
  ClubsView: ["import { ClubsView } from '@/components/ops/clubs-view';", '<ClubsView />'],
  ShowcaseView: ["import { ShowcaseView } from '@/components/ops/showcase-view';", '<ShowcaseView />'],
  // Alumni, newsroom social publishing, daily digest, student profile links.
  AlumniView: ["import { AlumniView } from '@/components/ops/alumni-social-views';", '<AlumniView />'],
  SocialPublishingView: ["import { SocialPublishingView } from '@/components/ops/alumni-social-views';", '<SocialPublishingView />'],
  DigestView: ["import { DigestView } from '@/components/ops/alumni-social-views';", '<DigestView />'],
  ProfileLinksView: ["import { ProfileLinksView } from '@/components/ops/alumni-social-views';", '<ProfileLinksView />'],
  // Sustainability, eco points, library labels and scan desk, AI drafts, online admission applications.
  SustainabilityView: ["import { SustainabilityView } from '@/components/ops/sustainability-view';", '<SustainabilityView />'],
  EcoPointsView: ["import { EcoPointsView } from '@/components/ops/sustainability-view';", '<EcoPointsView />'],
  LibraryLabelsView: ["import { LibraryLabelsView } from '@/components/ops/library-labels-view';", '<LibraryLabelsView />'],
  AiDraftsView: ["import { AiDraftsView } from '@/components/ops/ai-drafts-view';", '<AiDraftsView />'],
  OnlineApplicationsView: ["import { OnlineApplicationsView } from '@/components/ops/online-applications-view';", '<OnlineApplicationsView />'],
  // Offline and online campaigns, ad connectors, attribution and ROI.
  CampaignsHubView: ["import { CampaignsHubView } from '@/components/ops/growth-marketing-view';", '<CampaignsHubView />'],
  ConnectorsView: ["import { ConnectorsView } from '@/components/ops/growth-marketing-view';", '<ConnectorsView />'],
  AttributionView: ["import { AttributionView } from '@/components/ops/growth-marketing-view';", '<AttributionView />'],
  // Part 2 gaps: student support plans, competency portfolios, scenario planning, teacher presence.
  SupportPlansView: ["import { SupportPlansView } from '@/components/ops/support-plans-view';", '<SupportPlansView />'],
  PortfolioView: ["import { PortfolioView } from '@/components/ops/portfolio-view';", '<PortfolioView />'],
  ScenariosView: ["import { ScenariosView } from '@/components/ops/scenarios-view';", '<ScenariosView />'],
  PresenceView: ["import { PresenceView } from '@/components/ops/presence-view';", '<PresenceView />'],
};

const page = (portal, title, desc, view) => {
  const [imp, jsx] = VIEWS[view];
  return `'use client';
// Generated by scripts/generate-ops-pages.mjs from src/lib/ops-routes.json.
import { OpsPage } from '@/components/ops/ops-page';
${imp}

export default function Page() {
  return (
    <OpsPage portal="${portal}" title=${JSON.stringify(title)} desc=${JSON.stringify(desc)}>
      ${jsx}
    </OpsPage>
  );
}
`;
};

let written = 0;
const write = (rel, content) => {
  const file = path.join(root, 'src/app/[school]', rel, 'page.tsx');
  if (fs.existsSync(file) && !force) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written += 1;
};

for (const [portal, keys] of Object.entries(routes.portals)) {
  for (const key of keys) {
    const p = routes.pages[key];
    const title = key === 'today' && portal === 'principal' ? 'Command Centre' : p.title;
    write(`${portal}/${key}`, page(portal, title, p.desc, p.view));
  }
}

// Homes of the new portals, and the CRM inside the marketing portal.
write('hr', page('hr', 'Today', 'Verification, payroll, people and training — what needs you now.', 'RoleHome'));
write('compliance', page('compliance', 'Today', 'Safeguarding, statutory deadlines, notices and training coverage.', 'RoleHome'));
write('trustee', page('trustee', 'Governing body overview', 'Decisions for the board, meetings, budget and compliance at a glance.', 'RoleHome'));
write('marketing', page('marketing', 'Today', 'Enquiries, follow-ups, campaigns and seats.', 'RoleHome'));
write('alumnus', page('alumnus', 'Alumni', 'News from your institution, alumni circles and mentoring.', 'NewsroomView'));
const crm = path.join(root, 'src/app/[school]/marketing/admissions/page.tsx');
if (!fs.existsSync(crm) || force) {
  fs.mkdirSync(path.dirname(crm), { recursive: true });
  fs.writeFileSync(crm, `'use client';\n// Generated by scripts/generate-ops-pages.mjs.\nimport { AdmissionsScreen } from '@/components/admissions-screen';\n\nexport default function Page() {\n  return <AdmissionsScreen portal="marketing" />;\n}\n`);
  written += 1;
}
console.log(`ops pages written: ${written}`);

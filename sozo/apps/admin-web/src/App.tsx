import { BuildingsPage } from './pages/Buildings';
import { OperatorsPage } from './pages/Operators';
import { ZoneTypesPage } from './pages/ZoneTypes';
import { ObservationCategoriesPage } from './pages/ObservationCategories';
import { OperatorBillingPage } from './pages/OperatorBilling';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { AnalyticsPage } from './pages/Analytics';
import { ComplaintsPage } from './pages/Complaints';
import { DisputesPage } from './pages/Disputes';
import { PriceReleasesPage } from './pages/PriceReleases';
import { PriceReleaseDetailPage } from './pages/PriceReleaseDetail';
import { ClientsPage } from './pages/Clients';
import { OrganizationsPage } from './pages/Organizations';
import { OrganizationDetailPage } from './pages/OrganizationDetail';
import { MastersPage } from './pages/Masters';
import { MasterDetailPage } from './pages/MasterDetail';
import { UsersPage } from './pages/Users';
import { EquipmentPage } from './pages/Equipment';
import { StoresPage } from './pages/Stores';
import { BillingAccountsPage } from './pages/BillingAccounts';
import { BillingInvoicesPage } from './pages/BillingInvoices';
import { BillingPayoutsPage } from './pages/BillingPayouts';
import { BillingReceivablesPage } from './pages/BillingReceivables';
import { ConsumablesPage } from './pages/Consumables';
import { CancelReasonsPage } from './pages/CancelReasons';
import { ParametersPage } from './pages/Parameters';
import { AuditPage } from './pages/Audit';
import { BillingPeriodsPage } from './pages/BillingPeriods';
import { TaxRegistersPage } from './pages/TaxRegisters';
import { OpeningBalancesPage } from './pages/OpeningBalances';
import { ClearingPage } from './pages/Clearing';
import { LeadsPage } from './pages/Leads';
import { MastersFunnelPage } from './pages/MastersFunnel';
import { StockPage } from './pages/Stock';
import { ReserveFundPage } from './pages/ReserveFund';
import { SparePartsPage } from './pages/SpareParts';
import { ZonesPage } from './pages/Zones';
import { ComplaintTypesPage } from './pages/ComplaintTypes';
import { ObjectRatesPage } from './pages/ObjectRates';
import { HolidaysPage } from './pages/Holidays';
import { ToolChecklistsPage } from './pages/ToolChecklists';
import { InspectionChecklistsPage } from './pages/InspectionChecklists';
import { MapPage } from './pages/Map';
import { OrdersPage } from './pages/Orders';
import { CalculatorPage } from './pages/Calculator';
import { PromoCodesPage } from './pages/PromoCodes';
import { LoyaltyPage } from './pages/Loyalty';
import { CoveragePage } from './pages/Coverage';
import { SchedulerPage } from './pages/Scheduler';
import { MockEdoPage } from './pages/mock/Edo';
import { MockBankImportPage } from './pages/mock/BankImport';
import { Mock1cPage } from './pages/mock/Integrations1c';
import { ReferralsPage } from './pages/Referrals';
import { MockDepreciationPage } from './pages/mock/Depreciation';
import { MockLicenseesPage } from './pages/mock/Licensees';
import { MockUtmAnalyticsPage } from './pages/mock/UtmAnalytics';
import { MockNotificationsPage } from './pages/mock/Notifications';
import { AppHealthPage } from './pages/AppHealth';
import { InspectionActsPage } from './pages/InspectionActs';
import { BillingPenaltiesPage } from './pages/BillingPenalties';
import { PendingPage } from './pages/Pending';
import { RepresentativesPage } from './pages/Representatives';
import { DunningPage } from './pages/Dunning';
import { TechDebtPage } from './pages/TechDebt';
import { PurchaseCodesPage } from './pages/PurchaseCodes';
import { RatingEnginePage } from './pages/RatingEngine';
import { BadgesPage } from './pages/Badges';
import { MoneyFlowPage } from './pages/MoneyFlow';
import { MockTenantsPage } from './pages/mock/Tenants';
import { MockCampaignsPage } from './pages/mock/Campaigns';

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/buildings" element={<BuildingsPage />} />
            <Route path="/operators" element={<OperatorsPage />} />
            <Route path="/zone-types" element={<ZoneTypesPage />} />
            <Route path="/observation-categories" element={<ObservationCategoriesPage />} />
            <Route path="/operator-billing" element={<OperatorBillingPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/promo-codes" element={<PromoCodesPage />} />
            <Route path="/loyalty" element={<LoyaltyPage />} />
            <Route path="/price-releases" element={<PriceReleasesPage />} />
            <Route path="/price-releases/:id" element={<PriceReleaseDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
            <Route path="/masters" element={<MastersPage />} />
            <Route path="/masters/funnel" element={<MastersFunnelPage />} />
            <Route path="/masters/:id" element={<MasterDetailPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/stores" element={<StoresPage />} />
            <Route path="/billing/accounts" element={<BillingAccountsPage />} />
            <Route path="/billing/invoices" element={<BillingInvoicesPage />} />
            <Route path="/billing/payouts" element={<BillingPayoutsPage />} />
            <Route path="/billing/receivables" element={<BillingReceivablesPage />} />
            <Route path="/billing/clearing" element={<ClearingPage />} />
            <Route path="/billing/periods" element={<BillingPeriodsPage />} />
            <Route path="/billing/tax-registers" element={<TaxRegistersPage />} />
            <Route path="/billing/opening" element={<OpeningBalancesPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/reserve-fund" element={<ReserveFundPage />} />
            <Route path="/complaints" element={<ComplaintsPage />} />
            <Route path="/disputes" element={<DisputesPage />} />
            <Route path="/consumables" element={<ConsumablesPage />} />
            <Route path="/spare-parts" element={<SparePartsPage />} />
            <Route path="/zones" element={<ZonesPage />} />
            <Route path="/complaint-types" element={<ComplaintTypesPage />} />
            <Route path="/object-rates" element={<ObjectRatesPage />} />
            <Route path="/holidays" element={<HolidaysPage />} />
            <Route path="/tool-checklists" element={<ToolChecklistsPage />} />
            <Route path="/inspection-checklists" element={<InspectionChecklistsPage />} />
            <Route path="/cancel-reasons" element={<CancelReasonsPage />} />
            <Route path="/parameters" element={<ParametersPage />} />
            <Route path="/scheduler" element={<SchedulerPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/mock/edo" element={<MockEdoPage />} />
            <Route path="/mock/bank-import" element={<MockBankImportPage />} />
            <Route path="/mock/dunning" element={<Navigate to="/billing/dunning" replace />} />
            <Route path="/mock/integrations-1c" element={<Mock1cPage />} />
            <Route path="/mock/rating-engine" element={<Navigate to="/rating-engine" replace />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/mock/depreciation" element={<MockDepreciationPage />} />
            <Route path="/mock/licensees" element={<MockLicenseesPage />} />
            <Route path="/mock/purchase-codes" element={<Navigate to="/purchase-codes" replace />} />
            <Route path="/mock/techdebt" element={<Navigate to="/techdebt" replace />} />
            <Route path="/mock/utm-analytics" element={<MockUtmAnalyticsPage />} />
            <Route path="/mock/timers" element={<Navigate to="/scheduler" replace />} />
            <Route path="/mock/notifications" element={<MockNotificationsPage />} />
            <Route path="/mock/monitoring" element={<Navigate to="/app-health" replace />} />
            <Route path="/app-health" element={<AppHealthPage />} />
            <Route path="/acts" element={<InspectionActsPage />} />
            <Route path="/pending" element={<PendingPage />} />
            <Route path="/representatives" element={<RepresentativesPage />} />
            <Route path="/billing/dunning" element={<DunningPage />} />
            <Route path="/techdebt" element={<TechDebtPage />} />
            <Route path="/purchase-codes" element={<PurchaseCodesPage />} />
            <Route path="/rating-engine" element={<RatingEnginePage />} />
            <Route path="/badges" element={<BadgesPage />} />
            <Route path="/money-flow" element={<MoneyFlowPage />} />
            <Route path="/billing/penalties" element={<BillingPenaltiesPage />} />
            <Route path="/mock/tenants" element={<MockTenantsPage />} />
            <Route path="/mock/documents" element={<Navigate to="/organizations" replace />} />
            <Route path="/mock/badges" element={<Navigate to="/badges" replace />} />
            <Route path="/mock/campaigns" element={<MockCampaignsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

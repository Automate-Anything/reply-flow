import { useState, useCallback, useEffect } from 'react';
import {
  getAccessToken,
  getProfile,
  getReferrals,
  getStats,
  getCommissions,
  getBalance,
  getEarningsHistory,
  getFunnel,
} from '../api';

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  phone?: string;
  affiliate_code: string;
  commission_type?: string;
  commission_rate?: number;
  approval_status?: string;
  bank_account_added?: boolean;
}

export interface Stats {
  totalReferrals: number;
  activeCompanies: number;
  totalCommission: number;
  thisMonthCommission: number;
  conversionRate?: number;
  avgCommission?: number;
}

export interface Referral {
  id: string;
  company_name: string;
  status: string;
  plan_name: string;
  billing_cycle: string;
  commission_earned: number;
  created_at: string;
}

export interface CommissionEvent {
  id: string;
  event_type: string;
  plan_name: string;
  invoice_amount: number;
  commission_amount: number;
  stripe_invoice_id: string;
  created_at: string;
  company_name?: string;
}

export interface Balance {
  totalEarnedCents: number;
  totalPaidOutCents: number;
  pendingPayoutCents: number;
  balanceOwedCents: number;
}

export interface EarningsMonth {
  month: string;
  amountCents: number;
}

export interface FunnelData {
  clicks: number;
  signups: number;
  trials: number;
  active: number;
  churned: number;
  clickToSignupRate: number;
  signupToActiveRate: number;
}

export function usePortalData(isAuthed: boolean, onAuthFail: () => void) {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<CommissionEvent[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [earningsHistory, setEarningsHistory] = useState<EarningsMonth[]>([]);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      // First fetch profile to check approval status
      const profileRes = await getProfile();
      setAffiliate(profileRes.affiliate);

      // If not approved, don't fetch data endpoints (they'll 403)
      if (profileRes.affiliate?.approval_status && profileRes.affiliate.approval_status !== 'approved') {
        setDataLoading(false);
        return;
      }

      // Fetch all data in parallel
      const [statsRes, referralsRes, commissionsRes, balanceRes, earningsRes, funnelRes] = await Promise.all([
        getStats(),
        getReferrals(),
        getCommissions(),
        getBalance().catch(() => ({ totalEarnedCents: 0, totalPaidOutCents: 0, pendingPayoutCents: 0, balanceOwedCents: 0 })),
        getEarningsHistory().catch(() => ({ history: [] })),
        getFunnel().catch(() => ({ clicks: 0, signups: 0, trials: 0, active: 0, churned: 0, clickToSignupRate: 0, signupToActiveRate: 0 })),
      ]);
      setStats(statsRes);
      setReferrals(referralsRes.referrals);
      setCommissions(commissionsRes.events);
      setBalance(balanceRes);
      setEarningsHistory(earningsRes.history);
      setFunnel(funnelRes);
    } catch (err: any) {
      if (err.message?.includes('401') || !getAccessToken()) {
        onAuthFail();
      } else {
        setDataError(err.message || 'Failed to load data');
      }
    } finally {
      setDataLoading(false);
    }
  }, [onAuthFail]);

  useEffect(() => {
    if (isAuthed) loadData();
  }, [isAuthed, loadData]);

  const clearData = useCallback(() => {
    setAffiliate(null);
    setStats(null);
    setReferrals([]);
    setCommissions([]);
    setBalance(null);
    setEarningsHistory([]);
    setFunnel(null);
  }, []);

  return {
    affiliate,
    stats,
    referrals,
    commissions,
    balance,
    earningsHistory,
    funnel,
    dataLoading,
    dataError,
    loadData,
    clearData,
  };
}

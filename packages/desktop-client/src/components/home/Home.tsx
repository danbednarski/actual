import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { SvgAdd, SvgArrowThinRight } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  CategoryEntity,
} from '@actual-app/core/types/models';

import { Page } from '#components/Page';
import { CellValue, CellValueText } from '#components/spreadsheet/CellValue';
import { useAccounts } from '#hooks/useAccounts';
import { useCategories } from '#hooks/useCategories';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { SheetNameProvider } from '#hooks/useSheetName';
import { useSheetValue } from '#hooks/useSheetValue';
import { useSpreadsheet } from '#hooks/useSpreadsheet';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { envelopeBudget, trackingBudget } from '#spreadsheet/bindings';
import * as bindings from '#spreadsheet/bindings';

/**
 * What every open account has spent per category, this month and last. Same
 * subscription shape as useOverspentCategories: the budget sheet already has
 * these numbers, so there is nothing to query.
 *
 * Ordered by what was spent most this month. Categories with nothing spent
 * yet fall in behind, ordered by last month, so the list still ranks the ones
 * that usually matter early in a month. Anything untouched in both months
 * keeps the order the categories have in the budget.
 */
function useMonthSpendingByCategory(month: string) {
  const spreadsheet = useSpreadsheet();
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const { data: { list: categories } = { list: [] } } = useCategories();

  const expenseCategories = useMemo(
    () => categories.filter(category => !category.is_income),
    [categories],
  );

  const bindingsByCategory = useMemo(
    () =>
      expenseCategories.map(
        category =>
          [
            category,
            budgetType === 'tracking'
              ? trackingBudget.catSumAmount(category.id)
              : envelopeBudget.catSumAmount(category.id),
          ] as const,
      ),
    [budgetType, expenseCategories],
  );

  const [amounts, setAmounts] = useState<Record<string, IntegerAmount>>({});
  const [prevAmounts, setPrevAmounts] = useState<Record<string, IntegerAmount>>(
    {},
  );
  const sheetName = monthUtils.sheetForMonth(month);
  const prevSheetName = monthUtils.sheetForMonth(monthUtils.prevMonth(month));

  useEffect(() => {
    setAmounts({});
    setPrevAmounts({});
  }, [sheetName]);

  useEffect(() => {
    const unbinds = bindingsByCategory.flatMap(([category, binding]) => [
      spreadsheet.bind(sheetName, binding, result =>
        setAmounts(prev => ({ ...prev, [category.id]: Number(result.value) })),
      ),
      spreadsheet.bind(prevSheetName, binding, result =>
        setPrevAmounts(prev => ({
          ...prev,
          [category.id]: Number(result.value),
        })),
      ),
    ]);
    return () => unbinds.forEach(unbind => unbind());
  }, [bindingsByCategory, sheetName, prevSheetName, spreadsheet]);

  // Spending is stored negative; negating a zero would render as "-0.00".
  return useMemo(
    () =>
      expenseCategories
        .map((category, index) => ({
          category,
          index,
          amount: amounts[category.id] ? -amounts[category.id] : 0,
          prevAmount: prevAmounts[category.id] ? -prevAmounts[category.id] : 0,
        }))
        .sort(
          (a, b) =>
            b.amount - a.amount ||
            b.prevAmount - a.prevAmount ||
            a.index - b.index,
        ),
    [amounts, prevAmounts, expenseCategories],
  );
}

function Balances({ accounts }: { accounts: AccountEntity[] }) {
  return (
    <View
      style={{
        backgroundColor: theme.tableBackground,
        borderRadius: 12,
        padding: 20,
        boxShadow: `0 1px 2px ${theme.cardShadow}22`,
      }}
    >
      <Text style={{ color: theme.pageTextSubdued }}>
        <Trans>Total balance</Trans>
      </Text>
      <CellValue<'account', 'accounts-balance'>
        binding={bindings.allAccountBalance()}
        type="financial"
      >
        {props => (
          <CellValueText
            {...props}
            style={{ ...styles.veryLargeText, fontWeight: 500 }}
            data-testid="home-total-balance"
          />
        )}
      </CellValue>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 24,
          marginTop: 16,
        }}
      >
        {accounts.map(account => (
          <View key={account.id}>
            <Text style={{ color: theme.pageTextSubdued, fontSize: 12 }}>
              {account.name}
            </Text>
            <CellValue<'account', 'balance'>
              binding={bindings.accountBalance(account.id)}
              type="financial"
            >
              {props => (
                <CellValueText {...props} style={{ ...styles.mediumText }} />
              )}
            </CellValue>
          </View>
        ))}
      </View>
    </View>
  );
}

function MonthSpending({ month }: { month: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const spending = useMonthSpendingByCategory(month);

  // Both branches are subscribed because hooks cannot be conditional; only
  // the active budget type's sheet has a value.
  const envelopeSpent = useSheetValue<'envelope-budget', 'total-spent'>(
    envelopeBudget.totalSpent,
  );
  const trackingSpent = useSheetValue<'tracking-budget', 'total-spent'>(
    trackingBudget.totalSpent,
  );
  const totalSpent = budgetType === 'tracking' ? trackingSpent : envelopeSpent;
  // Negating a zero total would render as "-0.00".
  const spent = Number(totalSpent) ? -Number(totalSpent) : 0;
  const largest = spending.length > 0 ? spending[0].amount : 0;

  return (
    <View
      style={{
        backgroundColor: theme.tableBackground,
        borderRadius: 12,
        padding: 20,
        boxShadow: `0 1px 2px ${theme.cardShadow}22`,
      }}
    >
      <Text style={{ color: theme.pageTextSubdued }}>
        {t('Spent in {{month}}', {
          month: monthUtils.format(month, 'MMMM'),
        })}
      </Text>
      <Text
        style={{ ...styles.veryLargeText, fontWeight: 500 }}
        data-testid="home-total-spent"
      >
        {format(spent, 'financial')}
      </Text>

      {spending.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued, marginTop: 16 }}>
          <Trans>Nothing spent this month yet.</Trans>
        </Text>
      ) : (
        <View style={{ marginTop: 16, gap: 10 }}>
          {spending.map(({ category, amount }) => (
            <CategoryRow
              key={category.id}
              category={category}
              amount={amount}
              largest={largest}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function CategoryRow({
  category,
  amount,
  largest,
}: {
  category: CategoryEntity;
  amount: IntegerAmount;
  largest: IntegerAmount;
}) {
  const format = useFormat();

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ flex: 1 }}>{category.name}</Text>
        <Text style={{ fontWeight: 500 }}>{format(amount, 'financial')}</Text>
      </View>
      {/* Proportion of the biggest category, so the page reads at a glance */}
      <View
        style={{
          height: 4,
          marginTop: 4,
          borderRadius: 2,
          backgroundColor: theme.tableBorder,
        }}
      >
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${largest > 0 ? Math.round((amount / largest) * 100) : 0}%`,
            backgroundColor: theme.reportsRed,
          }}
        />
      </View>
    </View>
  );
}

export function Home() {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const navigate = useNavigate();
  const month = monthUtils.currentMonth();

  const { data: allAccounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const accounts = useMemo(
    () => allAccounts.filter(account => !account.closed),
    [allAccounts],
  );

  // Wide screens have no transaction entry screen, so send them to the
  // register, which opens its entry row on arrival.
  const enterTransaction = (params?: Record<string, string>) => {
    if (!isNarrowWidth) {
      void navigate('/accounts', { state: { addTransaction: true } });
      return;
    }
    const query = params ? `?${new URLSearchParams(params)}` : '';
    void navigate(`/transactions/new${query}`);
  };

  // With exactly two accounts, moving money is always one to the other, so
  // the button can name them and prefill both sides. More accounts than that
  // and it falls back to a blank transaction: there is no pair to assume.
  const transfer = useMemo(() => {
    if (accounts.length !== 2) return null;
    const [from, to] = accounts;
    const toPayee = payees.find(payee => payee.transfer_acct === to.id);
    if (!toPayee) return null;
    return { from, to, params: { account: from.id, payee: toPayee.id } };
  }, [accounts, payees]);

  return (
    <Page header={t('Home')}>
      <View
        style={{ gap: 16, paddingBottom: 20, maxWidth: 600, width: '100%' }}
      >
        <Balances accounts={accounts} />

        <View style={{ gap: 10 }}>
          <Button
            variant="primary"
            style={{ height: 52, ...styles.mediumText }}
            onPress={() => enterTransaction()}
            data-testid="home-add-expense"
          >
            <SvgAdd width={13} height={13} style={{ marginRight: 8 }} />
            <Trans>Add expense</Trans>
          </Button>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              style={{ flex: 1, height: 40 }}
              onPress={() => enterTransaction()}
            >
              <Trans>Add income</Trans>
            </Button>
            <Button
              style={{ flex: 1, height: 40 }}
              onPress={() => enterTransaction(transfer?.params)}
            >
              {transfer ? (
                <>
                  {transfer.from.name}
                  <SvgArrowThinRight
                    width={11}
                    height={11}
                    style={{ marginLeft: 6, marginRight: 6 }}
                  />
                  {transfer.to.name}
                </>
              ) : (
                <Trans>Move money</Trans>
              )}
            </Button>
          </View>
        </View>

        <SheetNameProvider name={monthUtils.sheetForMonth(month)}>
          <MonthSpending month={month} />
        </SheetNameProvider>
      </View>
    </Page>
  );
}

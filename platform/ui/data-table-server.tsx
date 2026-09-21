import { assertMaskedRows } from '@platform/data/query';
import { DataTableClient, type ColumnDef } from './data-table';

/**
 * Server-side DataTable wrapper — asserts rows came through platform query()
 * (masking guaranteed) before handing them to the client table. App code
 * should always use this component, never DataTableClient directly.
 */
export function DataTable(props: {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  appId: string;
  table?: string;
  onRowClick?: string;
  bulkActions?: { label: string; actionId: string }[];
}) {
  assertMaskedRows(props.rows);
  return <DataTableClient {...props} />;
}

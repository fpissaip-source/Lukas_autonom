import { Router, type IRouter } from "express";
import { queryRows } from "../lib/vps-db";
import {
  ListTradesQueryParams,
  ListTradesResponse,
  GetTradesSummaryQueryParams,
  GetTradesSummaryResponse,
  ListBankrollHistoryQueryParams,
  ListBankrollHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", async (req, res) => {
  try {
    const query = ListTradesQueryParams.parse(req.query);
    const limit = Math.min(query.limit ?? 100, 500);
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (query.status) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }
    if (query.bot) {
      params.push(query.bot);
      conditions.push(`bot = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const sql = `SELECT id, bot, market_slug, market_question, side,
                        shares::text, entry_price::text, stake::text,
                        status, opened_at, exit_price::text, payout::text,
                        pnl::text, closed_at
                 FROM trades ${where}
                 ORDER BY opened_at DESC
                 LIMIT $${params.length}`;

    const rows = await queryRows(sql, params);

    const countParams: unknown[] = [];
    const countConditions: string[] = [];
    if (query.status) {
      countParams.push(query.status);
      countConditions.push(`status = $${countParams.length}`);
    }
    if (query.bot) {
      countParams.push(query.bot);
      countConditions.push(`bot = $${countParams.length}`);
    }
    const countWhere = countConditions.length
      ? `WHERE ${countConditions.join(" AND ")}`
      : "";
    const countResult = await queryRows<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trades ${countWhere}`,
      countParams,
    );
    const total = parseInt(countResult[0]?.count ?? "0", 10);

    const mapped = rows.map((r) => ({
      ...r,
      opened_at: r.opened_at ? String(r.opened_at) : null,
      closed_at: r.closed_at ? String(r.closed_at) : null,
    }));

    const data = ListTradesResponse.parse({ trades: mapped, total });
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DATABASE_URL")) {
      res.status(503).json({ error: "Database not configured" });
    } else {
      res.status(503).json({ error: msg });
    }
  }
});

router.get("/trades/summary", async (req, res) => {
  try {
    const query = GetTradesSummaryQueryParams.parse(req.query);
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (query.bot) {
      params.push(query.bot);
      conditions.push(`bot = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const statsRows = await queryRows<{
      status: string;
      count: string;
      total_pnl: string | null;
    }>(
      `SELECT status,
              COUNT(*)::text AS count,
              SUM(pnl)::text AS total_pnl
       FROM trades ${where}
       GROUP BY status`,
      params,
    );

    let open_count = 0;
    let closed_count = 0;
    let win_count = 0;
    let loss_count = 0;
    let realized_pnl = 0;

    for (const row of statsRows) {
      const n = parseInt(row.count, 10);
      const pnl = parseFloat(row.total_pnl ?? "0") || 0;
      if (row.status === "open") {
        open_count = n;
      } else {
        closed_count += n;
        realized_pnl += pnl;
        if (pnl > 0) win_count += n;
        else if (pnl < 0) loss_count += n;
      }
    }

    const winCountRows = await queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM trades ${where ? where + " AND" : "WHERE"} pnl > 0`,
      params,
    );
    win_count = parseInt(winCountRows[0]?.count ?? "0", 10);

    const lossCountRows = await queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM trades ${where ? where + " AND" : "WHERE"} pnl < 0`,
      params,
    );
    loss_count = parseInt(lossCountRows[0]?.count ?? "0", 10);

    const win_rate =
      closed_count > 0 ? Math.round((win_count / closed_count) * 1000) / 10 : 0;

    const openParams = [...params];
    const openConditions = [...conditions, "status = 'open'"];
    const openWhere = `WHERE ${openConditions.join(" AND ")}`;
    const openRows = await queryRows(
      `SELECT id, bot, market_slug, market_question, side,
              shares::text, entry_price::text, stake::text,
              status, opened_at, exit_price::text, payout::text,
              pnl::text, closed_at
       FROM trades ${openWhere}
       ORDER BY opened_at DESC
       LIMIT 100`,
      openParams,
    );

    const openPositions = openRows.map((r) => ({
      ...r,
      opened_at: r.opened_at ? String(r.opened_at) : null,
      closed_at: r.closed_at ? String(r.closed_at) : null,
    }));

    const data = GetTradesSummaryResponse.parse({
      open_count,
      closed_count,
      total_count: open_count + closed_count,
      realized_pnl: Math.round(realized_pnl * 10000) / 10000,
      win_count,
      loss_count,
      win_rate,
      open_positions: openPositions,
    });
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DATABASE_URL")) {
      res.status(503).json({ error: "Database not configured" });
    } else {
      res.status(503).json({ error: msg });
    }
  }
});

router.get("/bankroll-history", async (req, res) => {
  try {
    const query = ListBankrollHistoryQueryParams.parse(req.query);
    const limit = Math.min(query.limit ?? 100, 500);
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (query.bot) {
      params.push(query.bot);
      conditions.push(`bot = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const sql = `SELECT id, bot, balance::text, base::text, pnl::text,
                        open_pos::text, note, recorded_at
                 FROM bankroll_history ${where}
                 ORDER BY recorded_at DESC
                 LIMIT $${params.length}`;

    const rows = await queryRows(sql, params);

    const countParams: unknown[] = [];
    const countConditions: string[] = [];
    if (query.bot) {
      countParams.push(query.bot);
      countConditions.push(`bot = $${countParams.length}`);
    }
    const countWhere = countConditions.length
      ? `WHERE ${countConditions.join(" AND ")}`
      : "";
    const countResult = await queryRows<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bankroll_history ${countWhere}`,
      countParams,
    );
    const total = parseInt(countResult[0]?.count ?? "0", 10);

    const mapped = rows.map((r) => ({
      ...r,
      recorded_at: r.recorded_at ? String(r.recorded_at) : null,
    }));

    const data = ListBankrollHistoryResponse.parse({ snapshots: mapped, total });
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DATABASE_URL")) {
      res.status(503).json({ error: "Database not configured" });
    } else {
      res.status(503).json({ error: msg });
    }
  }
});

export default router;

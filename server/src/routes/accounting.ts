import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { analyzeDocument, assessExpenseRisk, OcrResult } from "../services/ocrService";

const router = Router();

// ============================================================
// Documents（証憑アップロード・OCR）
// ============================================================

// 画像アップロード → documents レコード作成
router.post("/documents", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { file_base64, mime_type, original_filename, doc_type, site_id, client_id } = req.body;

        if (!file_base64 || !mime_type || !doc_type) {
            res.status(400).json({ error: "file_base64, mime_type, doc_type are required" });
            return;
        }

        // Base64 → Buffer
        const fileBuffer = Buffer.from(file_base64, "base64");
        const fileSize = fileBuffer.length;

        // SHA256 ハッシュ
        const crypto = await import("crypto");
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        // Storage にアップロード
        const timestamp = Date.now();
        const ext = original_filename?.split(".").pop() || "jpg";
        const storagePath = `${req.userId!}/${timestamp}.${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from("genba-documents")
            .upload(storagePath, fileBuffer, {
                contentType: mime_type,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        // documents レコード作成
        const { data, error } = await supabaseAdmin
            .from("documents")
            .insert({
                doc_type,
                storage_path: storagePath,
                original_filename,
                mime_type,
                file_size: fileSize,
                sha256,
                uploaded_by: req.userId!,
                site_id: site_id || null,
                client_id: client_id || null,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        console.error("Document upload error:", err);
        res.status(500).json({ error: err.message });
    }
});

// OCR解析
router.post("/ocr/analyze", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { document_id } = req.body;

        if (!document_id) {
            res.status(400).json({ error: "document_id is required" });
            return;
        }

        // ドキュメント取得
        const { data: doc, error: docError } = await supabaseAdmin
            .from("documents")
            .select("*")
            .eq("id", document_id)
            .single();

        if (docError || !doc) {
            res.status(404).json({ error: "Document not found" });
            return;
        }

        // Storage から画像取得
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
            .from("genba-documents")
            .download(doc.storage_path);

        if (downloadError || !fileData) {
            res.status(500).json({ error: "Failed to download file" });
            return;
        }

        // Blob → Base64
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        // OCR 実行（デフォルトプロバイダーを使用）
        const ocrResult: OcrResult = await analyzeDocument(base64, doc.mime_type);

        // documents 更新
        const { data: updated, error: updateError } = await supabaseAdmin
            .from("documents")
            .update({
                ocr_provider: ocrResult.provider,
                ocr_blocks: ocrResult.ocr_blocks,
                ocr_fields: ocrResult.ocr_fields,
                field_provenance: Object.keys(ocrResult.ocr_fields).reduce((acc, key) => {
                    acc[key] = { source: "ocr", at: new Date().toISOString() };
                    return acc;
                }, {} as Record<string, any>),
            })
            .eq("id", document_id)
            .select()
            .single();

        if (updateError) throw updateError;
        res.json(updated);
    } catch (err: any) {
        console.error("OCR analyze error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Expenses（経費）
// ============================================================

router.post("/expenses", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            cost_center,
            site_id,
            vendor_name,
            description,
            recorded_date,
            amount_subtotal,
            tax_amount,
            amount_total,
            category,
            source_document_id,
            input_sources,
        } = req.body;

        // リスク判定
        let risk_level: "LOW" | "HIGH" = "LOW";
        if (source_document_id) {
            const { data: doc } = await supabaseAdmin
                .from("documents")
                .select("ocr_fields")
                .eq("id", source_document_id)
                .single();

            if (doc?.ocr_fields) {
                const assessment = assessExpenseRisk(doc.ocr_fields, category || "other");
                risk_level = assessment.level;
            }
        }

        // 金額ベースのリスク判定（OCRがなくても）
        const total = amount_total || 0;
        if (
            (category === "material" || category === "tool") && total > 30000 ||
            (category === "food" || category === "travel") && total > 5000
        ) {
            risk_level = "HIGH";
        }

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .insert({
                kind: "expense",
                cost_center: cost_center || "SITE",
                site_id: cost_center === "HQ" ? null : site_id,
                vendor_name,
                description,
                recorded_date: recorded_date || new Date().toISOString().split("T")[0],
                amount_subtotal: amount_subtotal || 0,
                tax_amount: tax_amount || 0,
                amount_total: amount_total || 0,
                risk_level,
                source_document_id,
                input_sources: input_sources || {},
                created_by: req.userId!,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        console.error("Expense create error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 経費承認/否認
router.post("/expenses/:id/review", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { action, comment } = req.body; // action: 'approve' | 'reject'

        if (!["approve", "reject"].includes(action)) {
            res.status(400).json({ error: "action must be 'approve' or 'reject'" });
            return;
        }

        // 取引情報を取得して自己承認チェック
        const { data: tx, error: txError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("created_by, amount_total")
            .eq("id", id)
            .single();

        if (txError || !tx) {
            res.status(404).json({ error: "Transaction not found" });
            return;
        }

        // 自己承認防止チェック
        if (tx.created_by === req.userId) {
            res.status(403).json({ error: "自己承認は禁止されています" });
            return;
        }

        // 承認権限チェック
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("approval_limit, role")
            .eq("id", req.userId!)
            .single();

        const approvalLimit = profile?.approval_limit ?? 50000;
        const txAmount = tx.amount_total ?? 0;

        if (approvalLimit < txAmount && !["admin", "manager"].includes(profile?.role || "")) {
            res.status(403).json({
                error: `承認権限が不足しています（上限: ¥${approvalLimit.toLocaleString()}、申請額: ¥${txAmount.toLocaleString()}）`,
            });
            return;
        }

        const newStatus = action === "approve" ? "approved" : "rejected";
        const txStatus = action === "approve" ? "posted" : "draft";

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .update({
                review_status: newStatus,
                review_comment: comment,
                reviewed_at: new Date().toISOString(),
                status: txStatus,
            })
            .eq("id", id)
            .eq("reviewer_id", req.userId!)
            .select()
            .single();

        if (error) throw error;

        // 承認の場合は仕訳を作成
        if (action === "approve" && data) {
            await createJournalEntry(data, req.userId!);
        }

        res.json(data);
    } catch (err: any) {
        console.error("Expense review error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 複数経費の一括承認
router.post("/expenses/batch-review", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { ids, action, comment } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: "ids array is required" });
            return;
        }

        if (ids.length > 50) {
            res.status(400).json({ error: "Maximum 50 items per batch" });
            return;
        }

        if (!["approve", "reject"].includes(action)) {
            res.status(400).json({ error: "action must be 'approve' or 'reject'" });
            return;
        }

        // 承認者のプロファイル取得
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("approval_limit, role")
            .eq("id", req.userId!)
            .single();

        const approvalLimit = profile?.approval_limit ?? 50000;
        const isAdminOrManager = ["admin", "manager"].includes(profile?.role || "");

        const results: { success: string[]; failed: { id: string; error: string }[] } = {
            success: [],
            failed: [],
        };

        for (const id of ids) {
            try {
                // 取引情報を取得
                const { data: tx, error: txError } = await supabaseAdmin
                    .from("accounting_transactions")
                    .select("created_by, amount_total, reviewer_id")
                    .eq("id", id)
                    .single();

                if (txError || !tx) {
                    results.failed.push({ id, error: "取引が見つかりません" });
                    continue;
                }

                // 自己承認チェック
                if (tx.created_by === req.userId) {
                    results.failed.push({ id, error: "自己承認不可" });
                    continue;
                }

                // 承認者として割り当てられているかチェック
                if (tx.reviewer_id !== req.userId) {
                    results.failed.push({ id, error: "承認者として割り当てられていません" });
                    continue;
                }

                // 承認権限チェック
                const txAmount = tx.amount_total ?? 0;
                if (approvalLimit < txAmount && !isAdminOrManager) {
                    results.failed.push({ id, error: "承認権限不足" });
                    continue;
                }

                // 承認/否認実行
                const newStatus = action === "approve" ? "approved" : "rejected";
                const txStatus = action === "approve" ? "posted" : "draft";

                const { data: updated, error: updateError } = await supabaseAdmin
                    .from("accounting_transactions")
                    .update({
                        review_status: newStatus,
                        review_comment: comment,
                        reviewed_at: new Date().toISOString(),
                        status: txStatus,
                    })
                    .eq("id", id)
                    .select()
                    .single();

                if (updateError) {
                    results.failed.push({ id, error: updateError.message });
                    continue;
                }

                // 承認の場合は仕訳を作成
                if (action === "approve" && updated) {
                    await createJournalEntry(updated, req.userId!);
                }

                results.success.push(id);
            } catch (err: any) {
                results.failed.push({ id, error: err.message });
            }
        }

        res.json(results);
    } catch (err: any) {
        console.error("Batch review error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Sales（売上）
// ============================================================

router.post("/sales", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            site_id,
            client_id,
            description,
            recorded_date,
            amount_subtotal,
            tax_amount,
            amount_total,
            source_document_id,
            input_sources,
        } = req.body;

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .insert({
                kind: "sale",
                cost_center: "SITE",
                site_id,
                client_id,
                description,
                recorded_date: recorded_date || new Date().toISOString().split("T")[0],
                amount_subtotal: amount_subtotal || 0,
                tax_amount: tax_amount || 0,
                amount_total: amount_total || 0,
                status: "posted",
                source_document_id,
                input_sources: input_sources || {},
                created_by: req.userId!,
            })
            .select()
            .single();

        if (error) throw error;

        // 仕訳作成
        await createJournalEntry(data, req.userId!);

        res.status(201).json(data);
    } catch (err: any) {
        console.error("Sale create error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Invoices（請求書）
// ============================================================

router.post("/invoices", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { transaction_id, issue_date, due_date, billing_name, billing_address, notes } = req.body;

        // 請求書番号を採番
        const { data: invoiceNo, error: seqError } = await supabaseAdmin.rpc("rpc_next_invoice_no", {
            p_issue_date: issue_date || new Date().toISOString().split("T")[0],
        });

        if (seqError) throw seqError;

        const { data, error } = await supabaseAdmin
            .from("accounting_invoices")
            .insert({
                transaction_id,
                invoice_no: invoiceNo,
                issue_date: issue_date || new Date().toISOString().split("T")[0],
                due_date,
                billing_name,
                billing_address,
                notes,
                created_by: req.userId!,
            })
            .select()
            .single();

        if (error) throw error;

        // Transaction のステータス更新
        await supabaseAdmin
            .from("accounting_transactions")
            .update({ kind: "invoice" })
            .eq("id", transaction_id);

        res.status(201).json(data);
    } catch (err: any) {
        console.error("Invoice create error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Void（取消 / 逆仕訳）
// ============================================================

router.post("/void/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            res.status(400).json({ error: "reason is required" });
            return;
        }

        // 元の取引を取得
        const { data: original, error: fetchError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("*")
            .eq("id", id)
            .single();

        if (fetchError || !original) {
            res.status(404).json({ error: "Transaction not found" });
            return;
        }

        // 元の取引を voided に更新
        await supabaseAdmin
            .from("accounting_transactions")
            .update({
                status: "voided",
                voided_by: req.userId!,
                voided_at: new Date().toISOString(),
                void_reason: reason,
            })
            .eq("id", id);

        // 逆仕訳（マイナス金額）を作成
        const { data: reversal, error: reversalError } = await supabaseAdmin
            .from("accounting_transactions")
            .insert({
                kind: original.kind,
                cost_center: original.cost_center,
                site_id: original.site_id,
                client_id: original.client_id,
                vendor_name: original.vendor_name,
                description: `【取消】${original.description || ""} - ${reason}`,
                recorded_date: new Date().toISOString().split("T")[0],
                amount_subtotal: -original.amount_subtotal,
                tax_amount: -original.tax_amount,
                amount_total: -original.amount_total,
                status: "posted",
                voids_transaction_id: id,
                created_by: req.userId!,
            })
            .select()
            .single();

        if (reversalError) throw reversalError;

        // 逆仕訳の仕訳エントリ作成
        await createJournalEntry(reversal, req.userId!);

        res.json({ original_voided: id, reversal_created: reversal.id });
    } catch (err: any) {
        console.error("Void error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PL（月次損益）
// ============================================================

router.get("/pl", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { month, site_id, cost_center } = req.query;

        // デフォルトは今月
        const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);
        const startDate = `${targetMonth}-01`;
        // 月末日を正しく計算
        const [year, mon] = targetMonth.split("-").map(Number);
        const lastDay = new Date(year, mon, 0).getDate();
        const endDate = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select("*")
            .in("status", ["posted", "approved"])
            .gte("recorded_date", startDate)
            .lte("recorded_date", endDate);

        if (site_id) {
            query = query.eq("site_id", site_id);
        }
        if (cost_center) {
            query = query.eq("cost_center", cost_center);
        }

        const { data, error } = await query;

        if (error) throw error;

        // 集計
        let sales = 0;
        let expenses = 0;

        for (const tx of data || []) {
            if (tx.kind === "sale" || tx.kind === "invoice") {
                sales += tx.amount_total || 0;
            } else if (tx.kind === "expense") {
                expenses += tx.amount_total || 0;
            }
        }

        const profit = sales - expenses;
        const distributable = profit * 0.7; // 会社留保30%

        res.json({
            month: targetMonth,
            sales,
            expenses,
            profit,
            distributable,
            transaction_count: data?.length || 0,
        });
    } catch (err: any) {
        console.error("PL error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Transactions（取引一覧）
// ============================================================

// 取引検索
router.get("/transactions/search", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            q,
            kind,
            date_from,
            date_to,
            limit = 50,
            offset = 0,
        } = req.query;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select(`
                *,
                site:sites(id, name),
                client:clients(id, name),
                source_document:documents(id, storage_path, ocr_fields)
            `)
            .order("recorded_date", { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        // 種別フィルター
        if (kind && ["expense", "sale", "invoice"].includes(kind as string)) {
            query = query.eq("kind", kind);
        }

        // 日付範囲フィルター
        if (date_from) {
            query = query.gte("recorded_date", date_from as string);
        }
        if (date_to) {
            query = query.lte("recorded_date", date_to as string);
        }

        const { data, error } = await query;

        if (error) throw error;

        // テキスト検索（q）はDB側でILIKEを使うか、メモリでフィルタリング
        // Supabaseのor+ilikeは複雑なので、シンプルにメモリフィルタリングを採用
        let results = data || [];

        if (q && typeof q === "string" && q.trim()) {
            const searchTerm = q.toLowerCase().trim();
            results = results.filter((tx) => {
                const vendorMatch = tx.vendor_name?.toLowerCase().includes(searchTerm);
                const descMatch = tx.description?.toLowerCase().includes(searchTerm);
                const siteMatch = tx.site?.name?.toLowerCase().includes(searchTerm);
                const clientMatch = tx.client?.name?.toLowerCase().includes(searchTerm);
                return vendorMatch || descMatch || siteMatch || clientMatch;
            });
        }

        res.json(results);
    } catch (err: any) {
        console.error("Transaction search error:", err);
        res.status(500).json({ error: err.message });
    }
});

router.get("/transactions", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { kind, status, limit = 50, offset = 0 } = req.query;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select(`
        *,
        site:sites(id, name),
        client:clients(id, name),
        source_document:documents(id, storage_path, ocr_fields)
      `)
            .order("recorded_date", { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (kind) {
            query = query.eq("kind", kind);
        }
        if (status) {
            query = query.eq("status", status);
        }

        const { data, error } = await query;

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        console.error("Transactions error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 未承認取引一覧
router.get("/pending-approvals", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .select(`
        *,
        site:sites(id, name),
        source_document:documents(id, storage_path, ocr_fields)
      `)
            .eq("status", "pending_review")
            .eq("reviewer_id", req.userId!)
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        console.error("Pending approvals error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Helper: 仕訳エントリ作成
// ============================================================

async function createJournalEntry(transaction: any, userId: string) {
    const { data: entry, error: entryError } = await supabaseAdmin
        .from("accounting_journal_entries")
        .insert({
            transaction_id: transaction.id,
            entry_date: transaction.recorded_date,
            memo: transaction.description,
            posted_at: new Date().toISOString(),
            created_by: userId,
        })
        .select()
        .single();

    if (entryError) throw entryError;

    // 仕訳明細（消費税分離対応）
    const lines: any[] = [];
    let lineNo = 1;

    const subtotal = Math.abs(transaction.amount_subtotal || 0);
    const taxAmount = Math.abs(transaction.tax_amount || 0);
    const total = Math.abs(transaction.amount_total || 0);

    // 税区分から税率を判定（デフォルト10%）
    const taxRate = transaction.tax_category === "08_REDUCED" ? 0.08 : 0.10;

    if (transaction.kind === "sale" || transaction.kind === "invoice") {
        // 売上: 借方=売掛金、貸方=売上高+仮受消費税
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "1200",
            account_name: "売掛金",
            debit: total,
            credit: 0,
        });

        // 売上高（税抜）
        const salesAmount = subtotal > 0 ? subtotal : (taxAmount > 0 ? total - taxAmount : total);
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "4100",
            account_name: "売上高",
            debit: 0,
            credit: salesAmount,
            tax_rate: taxRate,
            tax_type: "taxable",
        });

        // 仮受消費税（税額がある場合）
        if (taxAmount > 0) {
            lines.push({
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "2500",
                account_name: "仮受消費税",
                debit: 0,
                credit: taxAmount,
            });
        }
    } else if (transaction.kind === "expense") {
        // 経費: 借方=経費+仮払消費税、貸方=現金

        // 経費（税抜）
        const expenseAmount = subtotal > 0 ? subtotal : (taxAmount > 0 ? total - taxAmount : total);
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "5100",
            account_name: "経費",
            debit: expenseAmount,
            credit: 0,
            tax_rate: taxRate,
            tax_type: "taxable",
        });

        // 仮払消費税（税額がある場合）
        if (taxAmount > 0) {
            lines.push({
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1500",
                account_name: "仮払消費税",
                debit: taxAmount,
                credit: 0,
            });
        }

        // 現金（税込総額）
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "1100",
            account_name: "現金",
            debit: 0,
            credit: total,
        });
    }

    if (lines.length > 0) {
        const { error: linesError } = await supabaseAdmin
            .from("accounting_journal_lines")
            .insert(lines);

        if (linesError) throw linesError;
    }
}

export default router;

import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminSupportRepository = {
  async listTickets({ search = "", status = "", priority = "", page = 1, limit = 15 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(t.ticket_number LIKE ? OR t.subject LIKE ? OR m.merchant_code LIKE ? OR p.company_name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (status && status !== "all") {
      conditions.push("t.status = ?");
      params.push(status);
    }
    if (priority && priority !== "all") {
      conditions.push("t.priority = ?");
      params.push(priority);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute(
      `
        SELECT COUNT(t.id) AS total
        FROM support_tickets t
        JOIN merchants m ON t.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT t.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email AS merchant_email,
               agent.email AS agent_email
        FROM support_tickets t
        JOIN merchants m ON t.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN users agent ON t.assigned_agent_id = agent.id
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      tickets: rows.map((r) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        ticket_number: r.ticket_number,
        merchantId: r.merchant_id,
        merchant_id: r.merchant_id,
        merchantCode: r.merchant_code,
        merchant_code: r.merchant_code,
        companyName: r.company_name,
        company_name: r.company_name,
        merchantEmail: r.merchant_email,
        merchant_email: r.merchant_email,
        assignedAgent: r.agent_email || "Unassigned",
        assigned_agent: r.agent_email || "Unassigned",
        subject: r.subject,
        priority: r.priority,
        status: r.status,
        category: r.category,
        createdAt: r.created_at,
        created_at: r.created_at,
        updatedAt: r.updated_at,
        updated_at: r.updated_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async getTicketDetails(id) {
    const [tRows] = await db.execute(
      `
        SELECT t.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email AS merchant_email,
               agent.email AS agent_email
        FROM support_tickets t
        JOIN merchants m ON t.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN users agent ON t.assigned_agent_id = agent.id
        WHERE t.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!tRows.length) return null;
    const t = tRows[0];

    const [msgRows] = await db.execute(
      `
        SELECT m.*, u.email AS sender_email, r.name AS sender_role
        FROM support_ticket_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE m.ticket_id = ?
        ORDER BY m.created_at ASC
      `,
      [id]
    );

    return {
      ticket: {
        id: t.id,
        ticketNumber: t.ticket_number,
        ticket_number: t.ticket_number,
        merchantId: t.merchant_id,
        merchant_id: t.merchant_id,
        merchantCode: t.merchant_code,
        merchant_code: t.merchant_code,
        companyName: t.company_name,
        company_name: t.company_name,
        merchantEmail: t.merchant_email,
        merchant_email: t.merchant_email,
        assignedAgent: t.agent_email || "Unassigned",
        assigned_agent: t.agent_email || "Unassigned",
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        category: t.category,
        createdAt: t.created_at,
        created_at: t.created_at,
        updatedAt: t.updated_at,
        updated_at: t.updated_at,
      },
      messages: msgRows.map((m) => {
        let parsedAttachments = [];
        if (typeof m.attachments === "string") {
          try {
            parsedAttachments = JSON.parse(m.attachments);
          } catch {
            parsedAttachments = [];
          }
        } else if (Array.isArray(m.attachments)) {
          parsedAttachments = m.attachments;
        }

        const isAdmin = m.sender_type === "admin";
        const senderName = isAdmin ? "BanglaQR Support Staff" : (t.company_name || "Merchant Representative");

        return {
          id: m.id,
          senderId: m.sender_id,
          sender_id: m.sender_id,
          senderEmail: m.sender_email || "System",
          sender_email: m.sender_email || "System",
          senderRole: m.sender_role || (isAdmin ? "Admin" : "Merchant"),
          sender_role: m.sender_role || (isAdmin ? "Admin" : "Merchant"),
          senderType: m.sender_type,
          sender_type: m.sender_type,
          senderName,
          sender_name: senderName,
          message: m.message,
          attachments: parsedAttachments,
          createdAt: m.created_at,
          created_at: m.created_at,
        };
      }),
    };
  },

  async addMessage(ticketId, senderId, senderType, message, attachments) {
    await db.execute(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, message, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [ticketId, senderId, senderType, message, attachments ? JSON.stringify(attachments) : null]
    );
    await db.execute("UPDATE support_tickets SET updated_at = NOW() WHERE id = ?", [ticketId]);
  },

  async updateStatus(ticketId, status, priority, assignedAgentId) {
    await db.execute(
      `UPDATE support_tickets SET
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        assigned_agent_id = COALESCE(?, assigned_agent_id),
        updated_at = NOW()
       WHERE id = ?`,
      [status || null, priority || null, assignedAgentId || null, ticketId]
    );
  },
};

export const adminSupportService = {
  async listTickets(filters) {
    return await adminSupportRepository.listTickets(filters);
  },

  async getTicket(id) {
    const t = await adminSupportRepository.getTicketDetails(id);
    if (!t) {
      const err = new Error("Ticket not found");
      err.statusCode = 404;
      throw err;
    }
    return t;
  },

  async replyTicket(id, message, adminUser, ip, userAgent) {
    await adminSupportRepository.addMessage(id, adminUser.id, "admin", message, null);
    await adminSupportRepository.updateStatus(id, "waiting_for_merchant", null, adminUser.id);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "ticket_reply",
      resourceType: "ticket",
      resourceId: id,
      details: { messageSnippet: message.slice(0, 100) },
      ip,
      userAgent,
    });
    return { success: true, message: "Reply sent successfully" };
  },

  async updateTicketStatus(id, { status, priority, assignedAgentId }, adminUser, ip, userAgent) {
    await adminSupportRepository.updateStatus(id, status, priority, assignedAgentId);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "ticket_status_change",
      resourceType: "ticket",
      resourceId: id,
      details: { status, priority },
      ip,
      userAgent,
    });
    return { success: true, message: "Ticket updated successfully" };
  },
};

export const adminSupportController = {
  async list(req, res, next) {
    try {
      const data = await adminSupportService.listTickets(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.ticketId);
      const data = await adminSupportService.getTicket(id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async reply(req, res, next) {
    try {
      const id = Number(req.params.ticketId);
      const { message } = req.body;
      if (!message || message.trim() === "") {
        return res.status(400).json({ success: false, message: "Message cannot be empty" });
      }
      const result = await adminSupportService.replyTicket(
        id,
        message,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const id = Number(req.params.ticketId);
      const result = await adminSupportService.updateTicketStatus(
        id,
        req.body,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};


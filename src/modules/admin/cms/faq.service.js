import { faqRepository } from "./faq.repository.js";

export const faqService = {
  async getPublishedFaqs() {
    return await faqRepository.getPublishedFaqs();
  },

  async getAllFaqs(filters) {
    return await faqRepository.getAllFaqs(filters);
  },

  async getById(id) {
    const faq = await faqRepository.getById(id);
    if (!faq) {
      const err = new Error("FAQ not found");
      err.statusCode = 404;
      throw err;
    }
    return faq;
  },

  async create(data) {
    const { question, answer, displayOrder, status } = data;
    if (!question || !question.trim()) {
      const err = new Error("প্রশ্ন (Question) আবশ্যক।");
      err.statusCode = 400;
      throw err;
    }
    if (!answer || !answer.trim()) {
      const err = new Error("উত্তর (Answer) আবশ্যক।");
      err.statusCode = 400;
      throw err;
    }

    return await faqRepository.create({
      question,
      answer,
      displayOrder,
      status: status === "draft" ? "draft" : "published",
    });
  },

  async update(id, data) {
    const { question, answer, displayOrder, status } = data;
    if (question !== undefined && !question.trim()) {
      const err = new Error("প্রশ্ন খালি রাখা যাবে না।");
      err.statusCode = 400;
      throw err;
    }
    if (answer !== undefined && !answer.trim()) {
      const err = new Error("উত্তর খালি রাখা যাবে না।");
      err.statusCode = 400;
      throw err;
    }

    const updated = await faqRepository.update(id, {
      question,
      answer,
      displayOrder,
      status,
    });

    if (!updated) {
      const err = new Error("FAQ not found to update");
      err.statusCode = 404;
      throw err;
    }

    return updated;
  },

  async delete(id) {
    const success = await faqRepository.delete(id);
    if (!success) {
      const err = new Error("FAQ not found or already deleted");
      err.statusCode = 404;
      throw err;
    }
    return { id, deleted: true };
  },

  async updateStatus(id, status) {
    if (!status || !["draft", "published"].includes(status)) {
      const err = new Error("Status must be either 'draft' or 'published'");
      err.statusCode = 400;
      throw err;
    }

    const updated = await faqRepository.updateStatus(id, status);
    if (!updated) {
      const err = new Error("FAQ not found");
      err.statusCode = 404;
      throw err;
    }

    return updated;
  },

  async reorder(items) {
    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error("Items array is required for reordering");
      err.statusCode = 400;
      throw err;
    }

    await faqRepository.reorder(items);
    return await faqRepository.getAllFaqs();
  },
};


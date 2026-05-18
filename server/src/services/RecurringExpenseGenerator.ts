import { supabaseAdmin } from "../lib/supabaseClient";

export class RecurringExpenseGenerator {
    async generateCurrentMonth(): Promise<void> {
        const { error } = await supabaseAdmin.rpc("generate_recurring_expenses_for_current_month");
        if (error) {
            throw new Error(`Failed to generate recurring expenses: ${error.message}`);
        }
    }
}

export const recurringExpenseGenerator = new RecurringExpenseGenerator();

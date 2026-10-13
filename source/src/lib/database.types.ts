export type Database = {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          company: string | null;
          position: string | null;
          notes: string;
          last_contact_date: string | null;
          next_contact_date: string | null;
          relationship_score: number;
          tags: string[];
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          company?: string | null;
          position?: string | null;
          notes?: string;
          last_contact_date?: string | null;
          next_contact_date?: string | null;
          relationship_score?: number;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string | null;
          phone?: string | null;
          company?: string | null;
          position?: string | null;
          notes?: string;
          last_contact_date?: string | null;
          next_contact_date?: string | null;
          relationship_score?: number;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
      };
      calls: {
        Row: {
          id: string;
          customer_id: string;
          scheduled_date: string;
          completed_date: string | null;
          duration_minutes: number;
          status: 'scheduled' | 'completed' | 'missed' | 'cancelled';
          outcome: 'positive' | 'neutral' | 'negative' | 'no_answer' | null;
          notes: string;
          follow_up_required: boolean;
          follow_up_date: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          scheduled_date: string;
          completed_date?: string | null;
          duration_minutes?: number;
          status?: 'scheduled' | 'completed' | 'missed' | 'cancelled';
          outcome?: 'positive' | 'neutral' | 'negative' | 'no_answer' | null;
          notes?: string;
          follow_up_required?: boolean;
          follow_up_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          scheduled_date?: string;
          completed_date?: string | null;
          duration_minutes?: number;
          status?: 'scheduled' | 'completed' | 'missed' | 'cancelled';
          outcome?: 'positive' | 'neutral' | 'negative' | 'no_answer' | null;
          notes?: string;
          follow_up_required?: boolean;
          follow_up_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      interactions: {
        Row: {
          id: string;
          customer_id: string;
          type: 'email' | 'meeting' | 'call' | 'note';
          subject: string | null;
          description: string;
          date: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          type?: 'email' | 'meeting' | 'call' | 'note';
          subject?: string | null;
          description: string;
          date?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          type?: 'email' | 'meeting' | 'call' | 'note';
          subject?: string | null;
          description?: string;
          date?: string;
          created_by?: string | null;
          created_at?: string;
        };
      };
      sales_invoices: {
        Row: {
          id: string;
          customer_id: string | null;
          action: string;
          date: string;
          invoice_no: string;
          customer_name: string;
          contact_number: string | null;
          location: string;
          payment_status: 'paid' | 'pending' | 'partial' | 'overdue';
          payment_method: string;
          total_amount: number;
          total_paid: number;
          sell_due: number;
          total_items: number;
          added_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id?: string | null;
          action?: string;
          date: string;
          invoice_no: string;
          customer_name: string;
          contact_number?: string | null;
          location?: string;
          payment_status?: 'paid' | 'pending' | 'partial' | 'overdue';
          payment_method?: string;
          total_amount?: number;
          total_paid?: number;
          sell_due?: number;
          total_items?: number;
          added_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string | null;
          action?: string;
          date?: string;
          invoice_no?: string;
          customer_name?: string;
          contact_number?: string | null;
          location?: string;
          payment_status?: 'paid' | 'pending' | 'partial' | 'overdue';
          payment_method?: string;
          total_amount?: number;
          total_paid?: number;
          sell_due?: number;
          total_items?: number;
          added_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};

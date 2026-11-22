/**
 * Golf OS — strict database types.
 *
 * Mirrors supabase/migrations/001_initial_schema.sql in the shape emitted by
 * `supabase gen types typescript`, with JSONB columns narrowed to their
 * contracts (CoursePricing, CourseMedia). Regenerate with
 * `npm run db:types` once a project is linked and diff against this file:
 * the JSONB narrowing below must be re-applied by hand.
 *
 * Units: every *_paise field is an integer amount in paise (INR x 100).
 * Time fields: `date` = "YYYY-MM-DD", `time` = "HH:MM:SS" (course-local wall
 * clock), `timestamptz` = ISO-8601 string.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ---------------------------------------------------------------------------
// Scalar aliases (documentational; all serialize as strings over PostgREST)
// ---------------------------------------------------------------------------
export type Uuid = string;
export type IsoDate = string;
export type IsoTime = string;
export type IsoTimestamp = string;
/** Integer amount in paise. 1 INR = 100 paise. */
export type Paise = number;
/** ISO weekday, 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ---------------------------------------------------------------------------
// JSONB contracts (enforced in SQL by is_valid_course_pricing / _media)
// ---------------------------------------------------------------------------
export type GreenFeeMatrix = {
  nine_holes: Paise;
  eighteen_holes: Paise;
};

export type CoursePricing = {
  weekday: GreenFeeMatrix;
  weekend: GreenFeeMatrix;
  weekend_isodow: IsoWeekday[];
  tournament_entry_addon: Paise;
  platform_convenience_fee_percent: number;
  /** Phase 4: flat green fee for non-members; members pay member_green_fee (0 at ASC). */
  guest_green_fee?: Paise;
  member_green_fee?: Paise;
};

export type CourseMedia = {
  hero_banner?: string;
  clubhouse?: string;
  signature_hole?: string;
  gallery?: string[];
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export type AppRole = "golfer" | "caddy" | "course_admin" | "super_admin";
export type HoleFormat = "front_9" | "back_9" | "full_18";
export type NineSide = "front" | "back";
export type TeeGender = "men" | "ladies" | "unisex";
export type SlotHoldStatus = "active" | "converted" | "released" | "expired";
export type BookingStatus = "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "refunded";
export type PaymentStatus = "paid" | "refund_pending" | "refunded" | "waived";
export type RoundMode = "normal" | "tournament";
export type RoundStatus = "scheduled" | "in_progress" | "completed" | "abandoned";
export type CaddyGrade = "grade_a" | "grade_b" | "grade_c";
export type CaddyAssignmentStatus = "held" | "confirmed" | "completed" | "released" | "cancelled";
export type LedgerEntryType = "round_earning" | "tip" | "adjustment" | "payout" | "payout_reversal";
export type LedgerDirection = "credit" | "debit";
export type PayoutStatus = "requested" | "approved" | "processing" | "paid" | "rejected" | "failed" | "cancelled";
export type HandicapTrack = "nine_hole" | "eighteen_hole";
export type MemberStatus = "active" | "lapsed";
export type GalleryCategory = "tournament" | "course" | "round" | "social";

/** Messages raised by RPCs and triggers (PostgrestError.message). */
export type GolfOsDbErrorCode =
  | "auth_required"
  | "payment_required"
  | "seat_has_caddy"
  | "caddy_already_checked_in"
  | "invalid_upi_id"
  | "caddy_upi_missing"
  | "payout_exceeds_balance"
  | "invalid_payout_transition"
  | "rejection_reason_required"
  | "insufficient_caddy_balance"
  | "free_confirm_failed"
  | "assignment_not_found"
  | "check_in_only_on_the_day"
  | "booking_not_active"
  | "round_not_open_yet"
  | "round_window_closed"
  | "round_not_found"
  | "scores_incomplete"
  | "course_not_bookable"
  | "back_nine_unavailable"
  | "course_closed_on_date"
  | "tee_time_outside_window"
  | "tee_time_off_grid"
  | "tee_time_in_past"
  | "beyond_booking_window"
  | "invalid_seat_count"
  | "slot_full"
  | "slot_not_empty_for_private"
  | "open_batch_join_disabled"
  | "seat_exceeds_player_count"
  | "booking_not_playable"
  | "invalid_initial_round_status"
  | "round_already_final"
  | "round_shape_immutable"
  | "course_has_no_tees"
  | "round_player_not_found"
  | "round_not_editable"
  | "hole_outside_round"
  | "hole_not_configured"
  | "caddy_course_mismatch"
  | "insufficient_caddy_balance"
  | "caddy_ledger_is_append_only"
  | "caddy_not_active"
  | "caddy_upi_missing"
  | "payout_exceeds_balance"
  | "payout_fields_immutable"
  | "payout_update_forbidden"
  | "invalid_payout_transition"
  | "rejection_reason_required"
  | "profile_privileged_column"
  | "caddy_self_service_column"
  | "inside_booking_cutoff"
  | "hold_not_found"
  | "hold_expired"
  | "hold_locked_for_payment"
  | "invalid_players"
  | "player_count_mismatch"
  | "seat_numbers_not_contiguous"
  | "tee_not_available"
  | "seat_not_found"
  | "caddy_unavailable"
  | "hold_details_missing"
  | "quote_mismatch"
  | "order_already_attached"
  | "order_not_found"
  | "booking_not_found"
  | "booking_not_cancellable"
  | "round_already_started";

export type NotificationChannel = "email" | "whatsapp" | "sms";
export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";

/** courses.cancellation_policy. The tier with the largest min_hours_before <= hours to tee applies. */
export interface CancellationPolicy {
  tiers: {
    min_hours_before: number;
    green_fee_refund_percent: number;
    caddy_fee_refund_percent: number;
  }[];
  refund_convenience_fee: boolean;
}

/** slot_holds.quote, written only by quote_slot_hold(). */
export interface HoldQuote {
  currency: string;
  players: number;
  is_weekend: boolean;
  green_fee_paise: Paise;
  caddy_fee_paise: Paise;
  tournament_addon_paise: Paise;
  convenience_fee_paise: Paise;
  convenience_fee_percent: number;
  total_paise: Paise;
  caddy_assignment_ids: Uuid[];
  quoted_at: IsoTimestamp;
  members?: number;
  guests?: number;
  member_green_fee_paise?: Paise;
  guest_green_fee_paise?: Paise;
  member_seats?: number[];
}

export type ConfirmPaymentResult =
  | "confirmed"
  | "already_confirmed"
  | "refund_amount_mismatch"
  | "refund_slot_taken"
  | "refund_caddy_taken";

export type TeeSheetUnavailableReason =
  | "course_closed_on_date"
  | "beyond_booking_window"
  | "tee_time_in_past"
  | "inside_booking_cutoff"
  | "private_four_ball"
  | "slot_full"
  | "open_batch_join_disabled";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: Uuid;
          username: string;
          full_name: string;
          avatar_url: string | null;
          bio: string | null;
          golfing_since: number | null;
          home_course_id: Uuid | null;
          role: AppRole;
          is_profile_public: boolean;
          handicap_18: number | null;
          avg_score_18: number | null;
          rounds_counted_18: number;
          handicap_9: number | null;
          avg_score_9: number | null;
          rounds_counted_9: number;
          handicap_updated_at: IsoTimestamp | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id: Uuid;
          username: string;
          full_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          golfing_since?: number | null;
          home_course_id?: Uuid | null;
          role?: AppRole;
          is_profile_public?: boolean;
          handicap_18?: number | null;
          avg_score_18?: number | null;
          rounds_counted_18?: number;
          handicap_9?: number | null;
          avg_score_9?: number | null;
          rounds_counted_9?: number;
          handicap_updated_at?: IsoTimestamp | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: {
          id?: Uuid;
          username?: string;
          full_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          golfing_since?: number | null;
          home_course_id?: Uuid | null;
          role?: AppRole;
          is_profile_public?: boolean;
          handicap_18?: number | null;
          avg_score_18?: number | null;
          rounds_counted_18?: number;
          handicap_9?: number | null;
          avg_score_9?: number | null;
          rounds_counted_9?: number;
          handicap_updated_at?: IsoTimestamp | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_home_course_fk";
            columns: ["home_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          id: Uuid;
          slug: string;
          name: string;
          short_name: string | null;
          tagline: string | null;
          description: string | null;
          established_year: number | null;
          course_type: string | null;
          area: string | null;
          city: string;
          state: string | null;
          postal_code: string | null;
          country: string;
          latitude: number | null;
          longitude: number | null;
          timezone: string;
          currency: string;
          holes_count: 9 | 18;
          first_tee_time: IsoTime;
          last_tee_time_18: IsoTime;
          last_tee_time_9: IsoTime;
          slot_interval_minutes: number;
          max_players_per_slot: number;
          min_players_per_booking: number;
          allow_join_open_batch: boolean;
          checkout_hold_minutes: number;
          round_duration_9_minutes: number;
          round_duration_18_minutes: number;
          booking_window_days: number;
          closed_weekdays: IsoWeekday[];
          pricing: CoursePricing;
          caddy_commission_percent: number;
          booking_cutoff_minutes: number;
          cancellation_policy: CancellationPolicy;
          facilities: string[];
          media: CourseMedia;
          is_active: boolean;
          is_published: boolean;
          created_by: Uuid | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
          member_sheet_url: string | null;
          members_synced_at: IsoTimestamp | null;
          members_sync_error: string | null;
        };
        Insert: {
          id?: Uuid;
          slug: string;
          name: string;
          short_name?: string | null;
          tagline?: string | null;
          description?: string | null;
          established_year?: number | null;
          course_type?: string | null;
          area?: string | null;
          city: string;
          state?: string | null;
          postal_code?: string | null;
          country?: string;
          latitude?: number | null;
          longitude?: number | null;
          timezone?: string;
          currency?: string;
          holes_count?: 9 | 18;
          first_tee_time?: IsoTime;
          last_tee_time_18?: IsoTime;
          last_tee_time_9?: IsoTime;
          slot_interval_minutes?: number;
          max_players_per_slot?: number;
          min_players_per_booking?: number;
          allow_join_open_batch?: boolean;
          checkout_hold_minutes?: number;
          round_duration_9_minutes?: number;
          round_duration_18_minutes?: number;
          booking_window_days?: number;
          closed_weekdays?: IsoWeekday[];
          pricing: CoursePricing;
          caddy_commission_percent?: number;
          booking_cutoff_minutes?: number;
          cancellation_policy?: CancellationPolicy;
          facilities?: string[];
          media?: CourseMedia;
          is_active?: boolean;
          is_published?: boolean;
          created_by?: Uuid | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
          member_sheet_url?: string | null;
          members_synced_at?: IsoTimestamp | null;
          members_sync_error?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["courses"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      course_admins: {
        Row: {
          course_id: Uuid;
          profile_id: Uuid;
          created_at: IsoTimestamp;
        };
        Insert: {
          course_id: Uuid;
          profile_id: Uuid;
          created_at?: IsoTimestamp;
        };
        Update: {
          course_id?: Uuid;
          profile_id?: Uuid;
          created_at?: IsoTimestamp;
        };
        Relationships: [
          {
            foreignKeyName: "course_admins_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_admins_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      course_tees: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          name: string;
          color_hex: string | null;
          gender: TeeGender;
          sort_order: number;
          par_18: number | null;
          par_front_9: number | null;
          par_back_9: number | null;
          total_yards: number | null;
          course_rating_18: number | null;
          slope_rating_18: number | null;
          course_rating_front_9: number | null;
          slope_rating_front_9: number | null;
          course_rating_back_9: number | null;
          slope_rating_back_9: number | null;
          is_default: boolean;
          is_active: boolean;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          name: string;
          color_hex?: string | null;
          gender?: TeeGender;
          sort_order?: number;
          par_18?: number | null;
          par_front_9?: number | null;
          par_back_9?: number | null;
          total_yards?: number | null;
          course_rating_18?: number | null;
          slope_rating_18?: number | null;
          course_rating_front_9?: number | null;
          slope_rating_front_9?: number | null;
          course_rating_back_9?: number | null;
          slope_rating_back_9?: number | null;
          is_default?: boolean;
          is_active?: boolean;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["course_tees"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "course_tees_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      course_holes: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          hole_number: number;
          /** Generated: holes 1–9 = front, 10–18 = back. */
          nine: NineSide;
          par: 3 | 4 | 5 | 6;
          stroke_index: number;
          name: string | null;
          description: string | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          hole_number: number;
          nine?: never;
          par: 3 | 4 | 5 | 6;
          stroke_index: number;
          name?: string | null;
          description?: string | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: {
          id?: Uuid;
          course_id?: Uuid;
          hole_number?: number;
          nine?: never;
          par?: 3 | 4 | 5 | 6;
          stroke_index?: number;
          name?: string | null;
          description?: string | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Relationships: [
          {
            foreignKeyName: "course_holes_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      hole_yardages: {
        Row: {
          course_id: Uuid;
          hole_id: Uuid;
          tee_id: Uuid;
          yards: number;
        };
        Insert: {
          course_id: Uuid;
          hole_id: Uuid;
          tee_id: Uuid;
          yards: number;
        };
        Update: {
          course_id?: Uuid;
          hole_id?: Uuid;
          tee_id?: Uuid;
          yards?: number;
        };
        Relationships: [
          {
            foreignKeyName: "hole_yardages_course_id_hole_id_fkey";
            columns: ["course_id", "hole_id"];
            isOneToOne: false;
            referencedRelation: "course_holes";
            referencedColumns: ["course_id", "id"];
          },
          {
            foreignKeyName: "hole_yardages_course_id_tee_id_fkey";
            columns: ["course_id", "tee_id"];
            isOneToOne: false;
            referencedRelation: "course_tees";
            referencedColumns: ["course_id", "id"];
          },
        ];
      };
      caddy_rate_tiers: {
        Row: {
          course_id: Uuid;
          grade: CaddyGrade;
          label: string;
          description: string | null;
          rate_9_paise: Paise;
          rate_18_paise: Paise;
        };
        Insert: {
          course_id: Uuid;
          grade: CaddyGrade;
          label: string;
          description?: string | null;
          rate_9_paise: Paise;
          rate_18_paise: Paise;
        };
        Update: {
          course_id?: Uuid;
          grade?: CaddyGrade;
          label?: string;
          description?: string | null;
          rate_9_paise?: Paise;
          rate_18_paise?: Paise;
        };
        Relationships: [
          {
            foreignKeyName: "caddy_rate_tiers_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      caddies: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          profile_id: Uuid | null;
          caddy_code: string;
          full_name: string;
          phone: string | null;
          grade: CaddyGrade;
          daily_rate_9_paise: Paise;
          daily_rate_18_paise: Paise;
          upi_id: string | null;
          years_experience: number | null;
          rating: number | null;
          photo_url: string | null;
          bio: string | null;
          is_available: boolean;
          is_active: boolean;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          profile_id?: Uuid | null;
          caddy_code: string;
          full_name: string;
          phone?: string | null;
          grade: CaddyGrade;
          daily_rate_9_paise: Paise;
          daily_rate_18_paise: Paise;
          upi_id?: string | null;
          years_experience?: number | null;
          rating?: number | null;
          photo_url?: string | null;
          bio?: string | null;
          is_available?: boolean;
          is_active?: boolean;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["caddies"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "caddies_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddies_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      slot_holds: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          profile_id: Uuid;
          play_date: IsoDate;
          tee_time: IsoTime;
          start_hole: 1 | 10;
          hole_format: HoleFormat;
          seats: number;
          is_private: boolean;
          tee_starts_at: IsoTimestamp;
          status: SlotHoldStatus;
          expires_at: IsoTimestamp;
          razorpay_order_id: string | null;
          converted_booking_id: Uuid | null;
          released_at: IsoTimestamp | null;
          created_at: IsoTimestamp;
          mode: RoundMode;
          tee_id: Uuid | null;
          quote: HoldQuote | null;
          total_paise: Paise | null;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          profile_id: Uuid;
          play_date: IsoDate;
          tee_time: IsoTime;
          start_hole: 1 | 10;
          hole_format: HoleFormat;
          seats: number;
          is_private?: boolean;
          tee_starts_at: IsoTimestamp;
          status?: SlotHoldStatus;
          expires_at: IsoTimestamp;
          razorpay_order_id?: string | null;
          converted_booking_id?: Uuid | null;
          released_at?: IsoTimestamp | null;
          created_at?: IsoTimestamp;
          mode?: RoundMode;
          tee_id?: Uuid | null;
          quote?: HoldQuote | null;
          total_paise?: Paise | null;
        };
        Update: Partial<Database["public"]["Tables"]["slot_holds"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "slot_holds_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slot_holds_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slot_holds_converted_booking_fk";
            columns: ["converted_booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          id: Uuid;
          booking_ref: string;
          course_id: Uuid;
          booked_by: Uuid;
          slot_hold_id: Uuid | null;
          play_date: IsoDate;
          tee_time: IsoTime;
          start_hole: 1 | 10;
          tee_starts_at: IsoTimestamp;
          hole_format: HoleFormat;
          tee_id: Uuid | null;
          player_count: number;
          is_private: boolean;
          mode: RoundMode;
          status: BookingStatus;
          payment_status: PaymentStatus;
          currency: string;
          green_fee_paise: Paise;
          caddy_fee_paise: Paise;
          tournament_addon_paise: Paise;
          convenience_fee_paise: Paise;
          total_paise: Paise;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          paid_at: IsoTimestamp | null;
          cancelled_at: IsoTimestamp | null;
          cancellation_reason: string | null;
          notes: string | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
          refund_paise: Paise;
          razorpay_refund_id: string | null;
          refunded_at: IsoTimestamp | null;
        };
        Insert: {
          id?: Uuid;
          /** Generated by trigger when omitted: GOS-YYMMDD-XXXXXX. */
          booking_ref?: string;
          course_id: Uuid;
          booked_by: Uuid;
          slot_hold_id?: Uuid | null;
          play_date: IsoDate;
          tee_time: IsoTime;
          /** Always overwritten by trigger from hole_format. */
          start_hole: 1 | 10;
          /** Always overwritten by trigger from play_date + tee_time in course timezone. */
          tee_starts_at: IsoTimestamp;
          hole_format: HoleFormat;
          tee_id?: Uuid | null;
          player_count: number;
          is_private?: boolean;
          mode?: RoundMode;
          status?: BookingStatus;
          payment_status?: PaymentStatus;
          currency?: string;
          green_fee_paise?: Paise;
          caddy_fee_paise?: Paise;
          tournament_addon_paise?: Paise;
          convenience_fee_paise?: Paise;
          total_paise: Paise;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          paid_at?: IsoTimestamp | null;
          cancelled_at?: IsoTimestamp | null;
          cancellation_reason?: string | null;
          notes?: string | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
          refund_paise?: Paise;
          razorpay_refund_id?: string | null;
          refunded_at?: IsoTimestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "bookings_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_booked_by_fkey";
            columns: ["booked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_slot_hold_id_fkey";
            columns: ["slot_hold_id"];
            isOneToOne: true;
            referencedRelation: "slot_holds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_course_id_tee_id_fkey";
            columns: ["course_id", "tee_id"];
            isOneToOne: false;
            referencedRelation: "course_tees";
            referencedColumns: ["course_id", "id"];
          },
        ];
      };
      booking_players: {
        Row: {
          id: Uuid;
          booking_id: Uuid;
          seat_number: 1 | 2 | 3 | 4;
          full_name: string;
          phone: string | null;
          email: string | null;
          profile_id: Uuid | null;
          is_booker: boolean;
          is_member: boolean;
          created_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          booking_id: Uuid;
          seat_number: 1 | 2 | 3 | 4;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          profile_id?: Uuid | null;
          is_booker?: boolean;
          created_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["booking_players"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "booking_players_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_players_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      caddy_assignments: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          caddy_id: Uuid;
          booking_id: Uuid | null;
          slot_hold_id: Uuid | null;
          booking_player_id: Uuid | null;
          hole_format: HoleFormat;
          starts_at: IsoTimestamp;
          ends_at: IsoTimestamp;
          status: CaddyAssignmentStatus;
          hold_expires_at: IsoTimestamp | null;
          rate_paise: Paise;
          seat_number: 1 | 2 | 3 | 4 | null;
          checked_in_at: IsoTimestamp | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          caddy_id: Uuid;
          booking_id?: Uuid | null;
          slot_hold_id?: Uuid | null;
          booking_player_id?: Uuid | null;
          hole_format: HoleFormat;
          starts_at: IsoTimestamp;
          ends_at: IsoTimestamp;
          status?: CaddyAssignmentStatus;
          hold_expires_at?: IsoTimestamp | null;
          rate_paise: Paise;
          seat_number?: 1 | 2 | 3 | 4 | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["caddy_assignments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "caddy_assignments_course_id_caddy_id_fkey";
            columns: ["course_id", "caddy_id"];
            isOneToOne: false;
            referencedRelation: "caddies";
            referencedColumns: ["course_id", "id"];
          },
          {
            foreignKeyName: "caddy_assignments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddy_assignments_slot_hold_id_fkey";
            columns: ["slot_hold_id"];
            isOneToOne: false;
            referencedRelation: "slot_holds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddy_assignments_booking_player_id_fkey";
            columns: ["booking_player_id"];
            isOneToOne: false;
            referencedRelation: "booking_players";
            referencedColumns: ["id"];
          },
        ];
      };
      rounds: {
        Row: {
          id: Uuid;
          booking_id: Uuid;
          course_id: Uuid;
          hole_format: HoleFormat;
          start_hole: 1 | 10;
          mode: RoundMode;
          status: RoundStatus;
          tournament_name: string | null;
          started_at: IsoTimestamp | null;
          completed_at: IsoTimestamp | null;
          created_by: Uuid | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          booking_id: Uuid;
          /** course_id, hole_format, start_hole and mode are copied from the booking by trigger. */
          course_id: Uuid;
          hole_format: HoleFormat;
          start_hole: 1 | 10;
          mode?: RoundMode;
          status?: Extract<RoundStatus, "scheduled" | "in_progress">;
          tournament_name?: string | null;
          started_at?: IsoTimestamp | null;
          completed_at?: IsoTimestamp | null;
          created_by?: Uuid | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: {
          id?: Uuid;
          booking_id?: Uuid;
          course_id?: Uuid;
          hole_format?: HoleFormat;
          start_hole?: 1 | 10;
          mode?: RoundMode;
          status?: RoundStatus;
          tournament_name?: string | null;
          started_at?: IsoTimestamp | null;
          completed_at?: IsoTimestamp | null;
          created_by?: Uuid | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Relationships: [
          {
            foreignKeyName: "rounds_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rounds_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rounds_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      round_players: {
        Row: {
          id: Uuid;
          round_id: Uuid;
          course_id: Uuid;
          booking_player_id: Uuid;
          profile_id: Uuid | null;
          tee_id: Uuid;
          display_name: string;
          handicap_index_at_start: number | null;
          course_handicap: number | null;
          holes_played: number;
          gross_score: number | null;
          adjusted_gross_score: number | null;
          net_score: number | null;
          score_differential: number | null;
          is_complete: boolean;
          counts_for_handicap: boolean;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          round_id: Uuid;
          course_id: Uuid;
          booking_player_id: Uuid;
          profile_id?: Uuid | null;
          tee_id: Uuid;
          display_name: string;
          handicap_index_at_start?: number | null;
          course_handicap?: number | null;
          holes_played?: number;
          gross_score?: number | null;
          adjusted_gross_score?: number | null;
          net_score?: number | null;
          score_differential?: number | null;
          is_complete?: boolean;
          counts_for_handicap?: boolean;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["round_players"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "round_players_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "round_players_booking_player_id_fkey";
            columns: ["booking_player_id"];
            isOneToOne: true;
            referencedRelation: "booking_players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "round_players_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "round_players_course_id_tee_id_fkey";
            columns: ["course_id", "tee_id"];
            isOneToOne: false;
            referencedRelation: "course_tees";
            referencedColumns: ["course_id", "id"];
          },
        ];
      };
      hole_scores: {
        Row: {
          id: Uuid;
          round_id: Uuid;
          round_player_id: Uuid;
          hole_number: number;
          strokes: number;
          putts: number | null;
          penalties: number;
          fairway_hit: boolean | null;
          green_in_regulation: boolean | null;
          par: number;
          stroke_index: number;
          strokes_received: number;
          /** Net Double Bogey capped strokes (par + 5 when no handicap index). */
          adjusted_strokes: number;
          recorded_by: Uuid | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          /** Overwritten by trigger from round_player_id. */
          round_id: Uuid;
          round_player_id: Uuid;
          hole_number: number;
          strokes: number;
          putts?: number | null;
          penalties?: number;
          fairway_hit?: boolean | null;
          green_in_regulation?: boolean | null;
          /** par, stroke_index, strokes_received, adjusted_strokes and recorded_by are trigger-computed. */
          par?: number;
          stroke_index?: number;
          strokes_received?: number;
          adjusted_strokes?: number;
          recorded_by?: Uuid | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["hole_scores"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "hole_scores_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hole_scores_round_player_id_fkey";
            columns: ["round_player_id"];
            isOneToOne: false;
            referencedRelation: "round_players";
            referencedColumns: ["id"];
          },
        ];
      };
      handicap_snapshots: {
        Row: {
          id: number;
          profile_id: Uuid;
          track: HandicapTrack;
          handicap_index: number | null;
          avg_score: number | null;
          rounds_counted: number;
          trigger_round_id: Uuid | null;
          created_at: IsoTimestamp;
        };
        Insert: {
          id?: never;
          profile_id: Uuid;
          track: HandicapTrack;
          handicap_index?: number | null;
          avg_score?: number | null;
          rounds_counted: number;
          trigger_round_id?: Uuid | null;
          created_at?: IsoTimestamp;
        };
        Update: {
          id?: never;
          profile_id?: Uuid;
          track?: HandicapTrack;
          handicap_index?: number | null;
          avg_score?: number | null;
          rounds_counted?: number;
          trigger_round_id?: Uuid | null;
          created_at?: IsoTimestamp;
        };
        Relationships: [
          {
            foreignKeyName: "handicap_snapshots_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "handicap_snapshots_trigger_round_id_fkey";
            columns: ["trigger_round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      caddy_ledger: {
        Row: {
          id: number;
          caddy_id: Uuid;
          course_id: Uuid;
          entry_type: LedgerEntryType;
          direction: LedgerDirection;
          amount_paise: Paise;
          balance_after_paise: Paise;
          caddy_assignment_id: Uuid | null;
          payout_request_id: Uuid | null;
          description: string | null;
          created_by: Uuid | null;
          created_at: IsoTimestamp;
        };
        Insert: {
          id?: never;
          caddy_id: Uuid;
          course_id: Uuid;
          entry_type: LedgerEntryType;
          direction: LedgerDirection;
          amount_paise: Paise;
          /** Computed by trigger under a caddy row lock. */
          balance_after_paise?: Paise;
          caddy_assignment_id?: Uuid | null;
          payout_request_id?: Uuid | null;
          description?: string | null;
          created_by?: Uuid | null;
          created_at?: IsoTimestamp;
        };
        /** Append-only: UPDATE and DELETE are rejected by trigger and privilege revoke. */
        Update: { [K in never]: never };
        Relationships: [
          {
            foreignKeyName: "caddy_ledger_caddy_id_fkey";
            columns: ["caddy_id"];
            isOneToOne: false;
            referencedRelation: "caddies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddy_ledger_caddy_assignment_id_fkey";
            columns: ["caddy_assignment_id"];
            isOneToOne: true;
            referencedRelation: "caddy_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddy_ledger_payout_request_id_fkey";
            columns: ["payout_request_id"];
            isOneToOne: false;
            referencedRelation: "caddy_payout_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      caddy_payout_requests: {
        Row: {
          id: Uuid;
          caddy_id: Uuid;
          course_id: Uuid;
          amount_paise: Paise;
          upi_id: string;
          status: PayoutStatus;
          note: string | null;
          requested_by: Uuid | null;
          reviewed_by: Uuid | null;
          reviewed_at: IsoTimestamp | null;
          rejection_reason: string | null;
          razorpayx_payout_id: string | null;
          utr: string | null;
          failure_reason: string | null;
          paid_at: IsoTimestamp | null;
          created_at: IsoTimestamp;
          updated_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          caddy_id: Uuid;
          /** course_id, upi_id, status and requested_by are set by trigger from the caddy record. */
          course_id: Uuid;
          amount_paise: Paise;
          upi_id: string;
          status?: PayoutStatus;
          note?: string | null;
          requested_by?: Uuid | null;
          reviewed_by?: Uuid | null;
          reviewed_at?: IsoTimestamp | null;
          rejection_reason?: string | null;
          razorpayx_payout_id?: string | null;
          utr?: string | null;
          failure_reason?: string | null;
          paid_at?: IsoTimestamp | null;
          created_at?: IsoTimestamp;
          updated_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["caddy_payout_requests"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "caddy_payout_requests_caddy_id_fkey";
            columns: ["caddy_id"];
            isOneToOne: false;
            referencedRelation: "caddies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caddy_payout_requests_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      gallery_photos: {
        Row: {
          id: Uuid;
          profile_id: Uuid;
          course_id: Uuid | null;
          round_id: Uuid | null;
          /** "{profile_id}/{file}" inside the golfer-gallery bucket. */
          storage_path: string;
          caption: string | null;
          category: GalleryCategory;
          width: number | null;
          height: number | null;
          taken_at: IsoTimestamp | null;
          is_public: boolean;
          created_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          profile_id: Uuid;
          course_id?: Uuid | null;
          round_id?: Uuid | null;
          storage_path: string;
          caption?: string | null;
          category?: GalleryCategory;
          width?: number | null;
          height?: number | null;
          taken_at?: IsoTimestamp | null;
          is_public?: boolean;
          created_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["gallery_photos"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "gallery_photos_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gallery_photos_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gallery_photos_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      slot_hold_players: {
        Row: {
          hold_id: Uuid;
          seat_number: 1 | 2 | 3 | 4;
          full_name: string;
          phone: string | null;
          email: string | null;
          is_booker: boolean;
          is_member: boolean;
        };
        /** Written only through save_hold_details(). */
        Insert: {
          hold_id: Uuid;
          seat_number: 1 | 2 | 3 | 4;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          is_booker?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["slot_hold_players"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "slot_hold_players_hold_id_fkey";
            columns: ["hold_id"];
            isOneToOne: false;
            referencedRelation: "slot_holds";
            referencedColumns: ["id"];
          },
        ];
      };
      club_members: {
        Row: {
          id: Uuid;
          course_id: Uuid;
          member_no: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          status: MemberStatus;
          source: "sheet" | "demo";
          synced_at: IsoTimestamp;
        };
        Insert: {
          id?: Uuid;
          course_id: Uuid;
          member_no: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          status?: MemberStatus;
          source?: "sheet" | "demo";
          synced_at?: IsoTimestamp;
        };
        Update: Partial<Database["public"]["Tables"]["club_members"]["Insert"]>;
        Relationships: [];
      };
      /** Service role only. */
      payment_events: {
        Row: {
          id: number;
          source: "checkout_callback" | "webhook" | "refund";
          event_type: string;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          razorpay_event_id: string | null;
          signature_verified: boolean;
          amount_paise: Paise | null;
          result: string | null;
          payload: Json;
          received_at: IsoTimestamp;
        };
        Insert: {
          source: "checkout_callback" | "webhook" | "refund";
          event_type: string;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          razorpay_event_id?: string | null;
          signature_verified: boolean;
          amount_paise?: Paise | null;
          result?: string | null;
          payload: Json;
          received_at?: IsoTimestamp;
        };
        /** Only the refund claim row is updated (result + refund id). */
        Update: { result?: string | null; payload?: Json };
        Relationships: [];
      };
      notification_log: {
        Row: {
          id: Uuid;
          booking_id: Uuid;
          course_id: Uuid;
          channel: NotificationChannel;
          template: string;
          recipient: string;
          status: NotificationStatus;
          attempts: number;
          last_error: string | null;
          provider_message_id: string | null;
          created_at: IsoTimestamp;
          sent_at: IsoTimestamp | null;
        };
        Insert: {
          id?: Uuid;
          booking_id: Uuid;
          course_id: Uuid;
          channel: NotificationChannel;
          template: string;
          recipient: string;
          status?: NotificationStatus;
          attempts?: number;
          last_error?: string | null;
          provider_message_id?: string | null;
          created_at?: IsoTimestamp;
          sent_at?: IsoTimestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["notification_log"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "notification_log_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_log_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      caddy_balances: {
        Row: {
          caddy_id: Uuid;
          course_id: Uuid;
          balance_paise: Paise;
          pending_payout_paise: Paise;
        };
        Relationships: [];
      };
      course_integrity_issues: {
        Row: {
          course_id: Uuid;
          tee_id: Uuid | null;
          issue:
            | "hole_count"
            | "par_18_mismatch"
            | "par_front_9_mismatch"
            | "par_back_9_mismatch"
            | "yardage_mismatch"
            | "missing_yardages"
            | "tee_unrated";
          detail: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      // ---- Public RPC surface ---------------------------------------------
      acquire_slot_hold: {
        Args: {
          p_course_id: Uuid;
          p_play_date: IsoDate;
          p_tee_time: IsoTime;
          p_hole_format: HoleFormat;
          p_seats: number;
          p_is_private?: boolean;
        };
        Returns: Database["public"]["Tables"]["slot_holds"]["Row"];
      };
      release_slot_hold: {
        Args: { p_hold_id: Uuid };
        Returns: undefined;
      };
      get_available_caddies: {
        Args: {
          p_course_id: Uuid;
          p_play_date: IsoDate;
          p_tee_time: IsoTime;
          p_hole_format: HoleFormat;
        };
        Returns: {
          caddy_id: Uuid;
          caddy_code: string;
          full_name: string;
          grade: CaddyGrade;
          grade_label: string | null;
          years_experience: number | null;
          rating: number | null;
          photo_url: string | null;
          bio: string | null;
          rate_paise: Paise;
          window_starts_at: IsoTimestamp;
          window_ends_at: IsoTimestamp;
        }[];
      };
      get_course_caddies: {
        Args: { p_course_id: Uuid };
        Returns: {
          caddy_id: Uuid;
          caddy_code: string;
          full_name: string;
          grade: CaddyGrade;
          grade_label: string | null;
          years_experience: number | null;
          rating: number | null;
          photo_url: string | null;
          bio: string | null;
          daily_rate_9_paise: Paise;
          daily_rate_18_paise: Paise;
          is_available: boolean;
        }[];
      };
      resolve_tee_slot: {
        Args: {
          p_course_id: Uuid;
          p_play_date: IsoDate;
          p_tee_time: IsoTime;
          p_hole_format: HoleFormat;
        };
        Returns: IsoTimestamp;
      };
      get_tee_sheet: {
        Args: { p_course_id: Uuid; p_play_date: IsoDate };
        Returns: {
          tee_time: IsoTime;
          start_hole: 1 | 10;
          tee_starts_at: IsoTimestamp;
          seats_taken: number;
          seats_left: number;
          is_private_locked: boolean;
          allows_front_9: boolean;
          allows_back_9: boolean;
          allows_full_18: boolean;
          unavailable_reason: TeeSheetUnavailableReason | null;
          price_9_paise: Paise;
          price_18_paise: Paise;
        }[];
      };
      save_hold_details: {
        Args: {
          p_hold_id: Uuid;
          p_players: Json;
          p_tee_id: Uuid;
          p_mode?: RoundMode;
        };
        Returns: Database["public"]["Tables"]["slot_hold_players"]["Row"][];
      };
      hold_caddy: {
        Args: { p_hold_id: Uuid; p_caddy_id: Uuid; p_seat_number: number };
        Returns: Database["public"]["Tables"]["caddy_assignments"]["Row"];
      };
      release_hold_caddy: {
        Args: { p_hold_id: Uuid; p_seat_number: number };
        Returns: undefined;
      };
      quote_slot_hold: {
        Args: { p_hold_id: Uuid };
        Returns: HoldQuote;
      };
      get_hold_caddies: {
        Args: { p_hold_id: Uuid };
        Returns: {
          assignment_id: Uuid;
          seat_number: 1 | 2 | 3 | 4;
          caddy_id: Uuid;
          caddy_code: string;
          full_name: string;
          grade: CaddyGrade;
          rating: number | null;
          rate_paise: Paise;
          hold_expires_at: IsoTimestamp;
        }[];
      };
      get_booking_caddies: {
        Args: { p_booking_id: Uuid };
        Returns: {
          seat_number: 1 | 2 | 3 | 4;
          caddy_code: string;
          full_name: string;
          grade: CaddyGrade;
          rating: number | null;
          photo_url: string | null;
          rate_paise: Paise;
          status: CaddyAssignmentStatus;
        }[];
      };
      cancel_booking: {
        Args: { p_booking_id: Uuid; p_reason?: string | null };
        Returns: { refund_paise: Paise; booking_status: BookingStatus }[];
      };
      // ---- Phase 4: members, caddie desk (007) ---------------------------------
      replace_sheet_members: {
        Args: { p_course_id: Uuid; p_rows: Json; p_error?: string | null };
        Returns: number;
      };
      is_club_member: {
        Args: { p_course_id: Uuid; p_phone: string | null; p_email: string | null };
        Returns: boolean;
      };
      confirm_free_hold: {
        Args: { p_hold_id: Uuid };
        Returns: Uuid;
      };
      claim_my_bookings: {
        Args: Record<string, never>;
        Returns: number;
      };
      get_caddy_schedule: {
        Args: { p_from: IsoDate; p_to: IsoDate };
        Returns: {
          assignment_id: Uuid;
          status: CaddyAssignmentStatus;
          checked_in_at: IsoTimestamp | null;
          rate_paise: Paise;
          seat_number: number | null;
          booking_id: Uuid;
          booking_ref: string;
          booking_status: BookingStatus;
          play_date: IsoDate;
          tee_time: IsoTime;
          start_hole: 1 | 10;
          hole_format: HoleFormat;
          player_name: string | null;
          group_names: string[] | null;
          player_count: number;
          course_name: string;
        }[];
      };
      caddy_check_in: {
        Args: { p_assignment_id: Uuid };
        Returns: IsoTimestamp;
      };
      seed_demo_tee_sheet: {
        Args: { p_course_id: Uuid; p_booker: Uuid; p_days?: number };
        Returns: number;
      };
      // ---- Phase 5: office controls, caddie pay (009) ---------------------------
      admin_assign_caddy: {
        Args: { p_booking_id: Uuid; p_caddy_id: Uuid; p_seat_number: number };
        Returns: Uuid;
      };
      admin_remove_caddy: {
        Args: { p_assignment_id: Uuid };
        Returns: undefined;
      };
      caddy_set_upi: {
        Args: { p_upi_id: string };
        Returns: undefined;
      };
      // ---- Phase 3: live scoring (006) -----------------------------------------
      start_round: {
        Args: { p_booking_id: Uuid };
        Returns: Uuid;
      };
      submit_round: {
        Args: { p_round_id: Uuid; p_abandon?: boolean };
        Returns: RoundStatus;
      };
      get_tournament_leaderboard: {
        Args: { p_course_id: Uuid; p_play_date: string };
        Returns: {
          round_player_id: Uuid;
          round_id: Uuid;
          display_name: string;
          tee_time: string;
          round_status: RoundStatus;
          holes_played: number;
          gross_score: number | null;
          net_score: number | null;
          gross_to_par: number;
          net_to_par: number;
          is_complete: boolean;
          rank_position: number | null;
        }[];
      };
      // ---- Service-role only (EXECUTE revoked from anon/authenticated) ------
      attach_razorpay_order: {
        Args: { p_hold_id: Uuid; p_order_id: string; p_amount_paise: Paise };
        Returns: Database["public"]["Tables"]["slot_holds"]["Row"];
      };
      confirm_hold_payment: {
        Args: { p_order_id: string; p_payment_id: string; p_amount_paise: Paise };
        Returns: { result: ConfirmPaymentResult; booking_id: Uuid | null }[];
      };
      mark_booking_refunded: {
        Args: { p_booking_id: Uuid; p_refund_id: string };
        Returns: undefined;
      };
      match_profile_for_contact: {
        Args: { p_phone: string | null; p_email: string | null };
        Returns: Uuid | null;
      };
      lock_own_active_hold: {
        Args: { p_hold_id: Uuid };
        Returns: Database["public"]["Tables"]["slot_holds"]["Row"];
      };
      recalculate_player_handicaps: {
        Args: { p_profile_id: Uuid; p_trigger_round_id?: Uuid | null };
        Returns: {
          handicap_18: number | null;
          avg_score_18: number | null;
          rounds_counted_18: number;
          handicap_9: number | null;
          avg_score_9: number | null;
          rounds_counted_9: number;
        }[];
      };
      finalize_round: {
        Args: { p_round_id: Uuid };
        Returns: undefined;
      };
      expire_stale_holds: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      refresh_round_player_totals: {
        Args: { p_round_player_id: Uuid };
        Returns: undefined;
      };
      slot_occupancy: {
        Args: {
          p_course_id: Uuid;
          p_play_date: IsoDate;
          p_tee_time: IsoTime;
          p_start_hole: number;
          p_exclude_booking?: Uuid | null;
          p_exclude_hold?: Uuid | null;
        };
        Returns: { seats_taken: number; has_private: boolean }[];
      };
      // ---- Pure helpers ----------------------------------------------------
      handicap_index_from_differentials: {
        Args: { p_diffs: number[] };
        Returns: number | null;
      };
      strokes_received: {
        Args: { p_course_handicap: number | null; p_rank: number; p_holes: number };
        Returns: number;
      };
      hole_difficulty_rank: {
        Args: { p_course_id: Uuid; p_hole_number: number; p_hole_format: HoleFormat };
        Returns: number;
      };
      tee_rating_for_format: {
        Args: { p_tee_id: Uuid; p_hole_format: HoleFormat };
        Returns: { course_rating: number; slope_rating: number; par: number; is_rated: boolean }[];
      };
      compute_course_handicap: {
        Args: {
          p_handicap_9: number | null;
          p_handicap_18: number | null;
          p_tee_id: Uuid;
          p_hole_format: HoleFormat;
        };
        Returns: { handicap_index: number | null; course_handicap: number | null }[];
      };
      slot_lock_key: {
        Args: { p_course_id: Uuid; p_play_date: IsoDate; p_tee_time: IsoTime; p_start_hole: number };
        Returns: number;
      };
      is_valid_course_pricing: { Args: { p: Json }; Returns: boolean };
      is_valid_course_media: { Args: { p: Json }; Returns: boolean };
      is_valid_cancellation_policy: { Args: { p: Json }; Returns: boolean };
      green_fee_per_player: {
        Args: { p_pricing: Json; p_play_date: IsoDate; p_hole_format: HoleFormat };
        Returns: Paise;
      };
      try_uuid: { Args: { p_value: string }; Returns: Uuid | null };
      // ---- RLS helpers (callable, return only facts about the caller) ------
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_course_admin: { Args: { p_course_id: Uuid }; Returns: boolean };
      is_course_visible: { Args: { p_course_id: Uuid }; Returns: boolean };
      current_caddy_id: { Args: Record<PropertyKey, never>; Returns: Uuid | null };
      is_booking_participant: { Args: { p_booking_id: Uuid }; Returns: boolean };
      is_round_participant: { Args: { p_round_id: Uuid }; Returns: boolean };
      is_public_round_player: { Args: { p_round_player_id: Uuid }; Returns: boolean };
      is_end_user_context: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: {
      app_role: AppRole;
      hole_format: HoleFormat;
      nine_side: NineSide;
      tee_gender: TeeGender;
      slot_hold_status: SlotHoldStatus;
      booking_status: BookingStatus;
      payment_status: PaymentStatus;
      round_mode: RoundMode;
      round_status: RoundStatus;
      caddy_grade: CaddyGrade;
      caddy_assignment_status: CaddyAssignmentStatus;
      ledger_entry_type: LedgerEntryType;
      ledger_direction: LedgerDirection;
      payout_status: PayoutStatus;
      handicap_track: HandicapTrack;
      gallery_category: GalleryCategory;
      notification_channel: NotificationChannel;
      notification_status: NotificationStatus;
      member_status: MemberStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ---------------------------------------------------------------------------
// Helper types (same names as Supabase codegen)
// ---------------------------------------------------------------------------
type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> =
  T extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][T]["Row"]
    : T extends keyof PublicSchema["Views"]
      ? PublicSchema["Views"][T]["Row"]
      : never;

export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
export type RpcArgs<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]["Args"];
export type RpcReturns<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]["Returns"];

export type Profile = Tables<"profiles">;
export type Course = Tables<"courses">;
export type CourseTee = Tables<"course_tees">;
export type CourseHole = Tables<"course_holes">;
export type Caddy = Tables<"caddies">;
export type SlotHold = Tables<"slot_holds">;
export type Booking = Tables<"bookings">;
export type BookingPlayer = Tables<"booking_players">;
export type CaddyAssignment = Tables<"caddy_assignments">;
export type Round = Tables<"rounds">;
export type RoundPlayer = Tables<"round_players">;
export type HoleScore = Tables<"hole_scores">;
export type CaddyLedgerEntry = Tables<"caddy_ledger">;
export type CaddyPayoutRequest = Tables<"caddy_payout_requests">;
export type GalleryPhoto = Tables<"gallery_photos">;
export type AvailableCaddy = RpcReturns<"get_available_caddies">[number];
export type PublicCaddy = RpcReturns<"get_course_caddies">[number];
export type SlotHoldPlayer = Tables<"slot_hold_players">;
export type NotificationLogEntry = Tables<"notification_log">;
export type PaymentEvent = Tables<"payment_events">;
export type TeeSheetSlot = RpcReturns<"get_tee_sheet">[number];
export type HoldCaddy = RpcReturns<"get_hold_caddies">[number];
export type BookingCaddy = RpcReturns<"get_booking_caddies">[number];
export type LeaderboardRow = RpcReturns<"get_tournament_leaderboard">[number];
export type ClubMember = Tables<"club_members">;
export type CaddyScheduleRow = RpcReturns<"get_caddy_schedule">[number];

export const Constants = {
  public: {
    Enums: {
      app_role: ["golfer", "caddy", "course_admin", "super_admin"],
      hole_format: ["front_9", "back_9", "full_18"],
      nine_side: ["front", "back"],
      tee_gender: ["men", "ladies", "unisex"],
      slot_hold_status: ["active", "converted", "released", "expired"],
      booking_status: ["confirmed", "checked_in", "completed", "cancelled", "no_show", "refunded"],
      payment_status: ["paid", "refund_pending", "refunded", "waived"],
      round_mode: ["normal", "tournament"],
      round_status: ["scheduled", "in_progress", "completed", "abandoned"],
      caddy_grade: ["grade_a", "grade_b", "grade_c"],
      caddy_assignment_status: ["held", "confirmed", "completed", "released", "cancelled"],
      ledger_entry_type: ["round_earning", "tip", "adjustment", "payout", "payout_reversal"],
      ledger_direction: ["credit", "debit"],
      payout_status: ["requested", "approved", "processing", "paid", "rejected", "failed", "cancelled"],
      handicap_track: ["nine_hole", "eighteen_hole"],
      gallery_category: ["tournament", "course", "round", "social"],
      notification_channel: ["email", "whatsapp", "sms"],
      notification_status: ["queued", "sent", "failed", "skipped"],
      member_status: ["active", "lapsed"],
    },
  },
} as const satisfies {
  public: { Enums: { [K in keyof PublicSchema["Enums"]]: readonly PublicSchema["Enums"][K][] } };
};

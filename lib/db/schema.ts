import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  archived: boolean("archived").notNull().default(false),
});

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["event", "assignment", "task"] }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  url: text("url"),
  at: timestamp("at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  status: text("status", { enum: ["todo", "doing", "done"] }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  offsetMinutes: integer("offset_minutes").notNull(),
  label: text("label").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  sent: boolean("sent").notNull().default(false),
});

export const reminderPresets = pgTable("reminder_presets", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull(),
  offsetMinutes: integer("offset_minutes").notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceLabel: text("device_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  id: integer("id").primaryKey().default(1),
  preset: text("preset", {
    enum: [
      "minimal",
      "midnight",
      "paper",
      "aurora",
      "mono",
      "noir",
      "sakura",
      "evergreen",
      "slate",
      "ember",
      "frost",
    ],
  })
    .notNull()
    .default("minimal"),
  landingView: text("landing_view", { enum: ["today", "calendar", "agenda"] })
    .notNull()
    .default("today"),
  density: text("density", { enum: ["compact", "comfortable", "spacious"] })
    .notNull()
    .default("comfortable"),
  weekStartsOn: integer("week_starts_on").notNull().default(0),
  clock24h: boolean("clock_24h").notNull().default(false),
  showLocation: boolean("show_location").notNull().default(true),
  showCategoryDot: boolean("show_category_dot").notNull().default(true),
  defaultReminderPresetIds: jsonb("default_reminder_preset_ids").notNull().default([]),
});

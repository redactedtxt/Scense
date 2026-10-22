-- M9 fixes (DECISIONS B35): the catalogue ids of bottles a visitor named in a chat
-- message ("my favourite is ..."). User rows only. Kept so those bottles stay out of the
-- recommendations for the rest of that day's conversation: the visitor already knows them.
ALTER TABLE chat_messages ADD COLUMN named_fragrances INTEGER[];

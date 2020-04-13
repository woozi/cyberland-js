module.exports = {
    setupDb: async function (pool, boards) {
        const client = await pool.connect();

        // Setup table schemas and triggers
        await client.query(`
        create table if not exists board (
            name varchar(8) primary key,
            title varchar not null
        );
        create table if not exists post (
            boardName varchar(8),
            id integer default 0,
            ipHash char(32) default '',
            postedTime timestamp default (now() at time zone 'utc'),
            content varchar(500) not null,
            replyTo integer,
            bumpTime timestamp default (now() at time zone 'utc'),
            primary key (boardName, id),
            foreign key (boardName) references board (name),
            foreign key (boardName, replyTo) references post (boardName, id)
        );
        
        create or replace function createIdSeqForBoard() returns trigger as $$
        declare
            sql varchar := 'create sequence if not exists seqPostId_' || new.name || ' minvalue 1 start 1 owned by board.name';
        begin
            execute sql;
            return new;
        end;
        $$ language plpgsql;
        drop trigger if exists newBoardAdded on board;
        create trigger newBoardAdded after insert on board for each row execute procedure createIdSeqForBoard();
        
        create or replace function setNewPostId() returns trigger as $$
        begin
            new.id := nextval('seqPostId_' || new.boardName);
            return new;
        end;
        $$ language plpgsql;
        drop trigger if exists newPostBeforeAdded on post;
        create trigger newPostBeforeAdded before insert on post for each row execute procedure setNewPostId();
        
        create or replace function updateBumpTime() returns trigger as $$
        begin
            update post set bumpTime = new.bumpTime where id = new.replyTo;
            return new;
        end;
        $$ language plpgsql;
        drop trigger if exists newPostAdded on post;
        create trigger newPostAdded after insert or update on post for each row execute procedure updateBumpTime();
        `);

        // Add boards
        for (let i = 0; i < boards.length; i++) {
            const {name, title} = boards[i];
            await client.query(
                'insert into board (name, title) values ($1, $2) on conflict do nothing', 
                [name, title]);
        }

        client.release();
    }
};
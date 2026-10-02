using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tasklog.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPersons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Persons",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Relation = table.Column<string>(type: "TEXT", nullable: true),
                    WhoTheyAre = table.Column<string>(type: "TEXT", nullable: true),
                    RhythmDays = table.Column<int>(type: "INTEGER", nullable: true),
                    LastContactAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Birthday = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ThreadsJson = table.Column<string>(type: "TEXT", nullable: false),
                    NextTime = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Persons", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Persons");
        }
    }
}

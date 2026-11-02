import { useEffect, useState } from "react";
import { ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "../services/api.js";
import PageHeader from "../components/PageHeader.jsx";
import Notice from "../components/Notice.jsx";
import Loading from "../components/Loading.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ListPagination from "../components/ListPagination.jsx";
import { paginateItems } from "../utils/pagination.js";

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pagination = paginateItems(users, page);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await api("/users");
      setUsers(data.items || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function changeRole(userId, role) {
    try {
      await api(`/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setMessage("User role updated.");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteUser(user) {
    if (!window.confirm(`Delete the account for ${user.name}?`)) return;

    try {
      await api(`/users/${user.id}`, {
        method: "DELETE",
      });
      setMessage("User account deleted.");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="container workspace-container">
      <PageHeader
        eyebrow="ACCESS CONTROL"
        title="User management"
        description="Review student profiles and assign application permissions."
      />

      <Notice type="success" onClose={() => setMessage("")}>
        {message}
      </Notice>

      <Notice type="error" onClose={() => setError("")}>
        {error}
      </Notice>

      <div className="notice notice-info">
        <ShieldCheck size={18} />
        <span>
          Verified registrations receive Student access. Only Admins can view academic details or change a role.
        </span>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Application users <span className="count-badge">{users.length}</span>
            </h2>
            <p>Do not grant Admin permissions unless the person is authorized.</p>
          </div>
        </div>

        {loading ? (
          <Loading label="Loading user accounts..." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Academic profile</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="student-cell">
                        <div className="student-avatar">
                          {user.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <strong>{user.name}</strong>
                          <small>{user.email}</small>
                        </div>
                      </div>
                    </td>

                    <td>
                      {user.studentProfile ? (
                        <div className="student-academic-cell">
                          <strong>{user.studentProfile.program} · {user.studentProfile.branch}</strong>
                          <small>Roll no. {user.studentProfile.rollNumber}</small>
                          <small>Gender: {user.studentProfile.gender || "Not provided"}</small>
                          <small>
                            Year {user.studentProfile.yearOfStudy} · Pass-out {user.studentProfile.passingOutYear}
                          </small>
                          <small>{user.studentProfile.phone}</small>
                          <small>{user.studentProfile.address}</small>
                        </div>
                      ) : (
                        <span className="table-subtext">No student profile</span>
                      )}
                    </td>

                    <td>
                      <div className="user-role-cell">
                        <StatusBadge value={user.role} />
                        <select
                          aria-label={`Change role for ${user.name}`}
                          value={user.role}
                          onChange={(e) => changeRole(user.id, e.target.value)}
                        >
                          <option value="student">Student</option>
                          <option value="viewer">Viewer</option>
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </td>

                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>

                    <td>
                      <button
                        type="button"
                        className="icon-button danger-icon"
                        aria-label={`Delete ${user.name}`}
                        title="Delete user"
                        onClick={() => deleteUser(user)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}

                {!users.length && (
                  <tr>
                    <td colSpan="5">
                      <div className="empty-inline">
                        <Users size={26} />
                        <strong>No users found</strong>
                        <span>Registered accounts will appear here.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <ListPagination pagination={pagination} onPageChange={setPage} />
      </section>
    </div>
  );
}
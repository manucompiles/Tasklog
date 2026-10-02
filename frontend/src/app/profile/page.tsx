// Route: /profile - the living profile made visible (v4.1 Stage B, #92, pin 15).
import ProfileClient from "@/components/profile/ProfileClient";

export default function ProfilePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <ProfileClient />
    </div>
  );
}

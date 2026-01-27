import { motion } from "framer-motion";
import { MapPin, Zap, Calendar, Award, Palmtree } from "lucide-react";
import { StaminaBar } from "./StaminaBar";
import type { PartyMember } from "../lib/api";
import styles from "./PartyMemberCard.module.css";

interface PartyMemberCardProps {
    member: PartyMember;
    index: number;
}

export function PartyMemberCard({ member, index }: PartyMemberCardProps) {
    const holidayProgress = Math.round((member.holidayDays / member.holidayTarget) * 100);

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
        >
            {/* ヘッダー */}
            <div className={styles.header}>
                <div className={styles.avatar}>
                    {member.name?.charAt(0) || "?"}
                </div>
                <div className={styles.info}>
                    <h3 className={styles.name}>{member.name}</h3>
                    <span className={`${styles.status} ${member.isOnHoliday ? styles.holiday : styles.working}`}>
                        {member.isOnHoliday ? (
                            <>
                                <Palmtree size={12} />
                                休暇中
                            </>
                        ) : (
                            <>
                                <MapPin size={12} />
                                {member.currentSite?.name || "待機中"}
                            </>
                        )}
                    </span>
                </div>
            </div>

            {/* スタミナ */}
            <div className={styles.section}>
                <div className={styles.sectionLabel}>
                    <Zap size={14} />
                    スタミナ
                </div>
                <StaminaBar value={member.stamina} />
            </div>

            {/* 休暇 */}
            <div className={styles.section}>
                <div className={styles.sectionLabel}>
                    <Calendar size={14} />
                    休暇
                </div>
                <div className={styles.holidayInfo}>
                    <span className={styles.holidayCount}>
                        {member.holidayDays} / {member.holidayTarget}日
                    </span>
                    <span className={`${styles.pace} ${styles[member.holidayPace]}`}>
                        {member.holidayPace === "on_track" ? "順調" : "遅れ"}
                    </span>
                </div>
                <div className={styles.holidayBar}>
                    <motion.div
                        className={styles.holidayFill}
                        initial={{ width: 0 }}
                        animate={{ width: `${holidayProgress}%` }}
                        transition={{ duration: 0.5, delay: index * 0.1 + 0.2 }}
                    />
                </div>
            </div>

            {/* パーク */}
            <div className={styles.footer}>
                <Award size={14} />
                <span>{member.perkCount} パーク取得</span>
            </div>
        </motion.div>
    );
}

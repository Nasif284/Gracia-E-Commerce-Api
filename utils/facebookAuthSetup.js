import { Strategy as FacebookStrategy } from "passport-facebook";
import userModel from "../models/user.model.js";
import passport from "passport";

passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: "/api/user/facebook/callback",
      proxy: true,
      profileFields: ["id", "emails", "name", "displayName", "photos"],
    },
    
    async (_, __, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error("No email from Facebook"));

        let user = await userModel.findOne({ email });
        if (!user) {
          user = new userModel({
            name: profile.displayName || `${profile.name.givenName} ${profile.name.familyName}`,
            email,
            isVerified: true,
            facebookId: profile.id,
          });
          await user.save();
        } else {
          const updated = {};
          if (!user.facebookId) updated.facebookId = profile.id;
          if (Object.keys(updated).length) {
            await userModel.findByIdAndUpdate(user._id, updated, { new: true });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);
